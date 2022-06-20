const app = require('express')();
var cors = require('cors');
const { RateLimiterClusterMaster, RateLimiterCluster } = require('rate-limiter-flexible');
app.use(cors);
const { v1: uuidv1 } = require('uuid');
const redis = require('redis');
const { setupMaster, setupWorker } = require("@socket.io/sticky");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");
const cluster = require('cluster');
const numCPUs = require("os").cpus().length;


const initGame = () => {
  const url='redis://redis:6379';
  const client = redis.createClient({url});
  // const pubClient = redis.createClient();
  // const subClient = pubClient.duplicate();
  client.connect();

  client.on('ready', (data) => {
    console.log('redis connection successful');
  });

  const server = require('http').createServer(app);
  const io = require('socket.io')(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    }
  });
  // use the cluster adapter
  io.adapter(createAdapter());
  setupWorker(io);

  const mapPrefix = 'at-tic-tac-toe:';

  const rateLimiter = new RateLimiterCluster({
    keyPrefix: 'myclusterlimiter'+uuidv1(), // Must be unique for each limiter
    points: 1,
    duration: 15*60,
  });

  io.sockets.on('connection', (socket) => {
    socket.on('clientDetails', async (data) => {
      try {
        await rateLimiter.consume(socket.handshake.address, 1);
        console.log('user details', data);
        console.log(`Worker ${process.pid} serving`);
        const isUserAlreadyExists = await isRecordExistsOnRedisHMap(data.email);
        if (!isUserAlreadyExists) {
          insertOnRedisHMap(data.email, { socketId: socket.id, gameId: null });
          await enqueue('queue', data.email);
        }
      } catch (error) {
        socket.emit('blocked', { 'retry-ms': error.msBeforeNext });
      }
    });
    socket.on('user_move', (data) => {
      broadCastGamePlayEvent(data);
    });
  });

  setInterval(async () => {
    let size = await getQueueSize('queue');
    if (size >= 2) {
      while (size >= 2) {
        const [player1, player2, queueSize] = await client
          .multi()
          .lPop(mapPrefix + 'queue')
          .lPop(mapPrefix + 'queue')
          .lRange(mapPrefix + 'queue', 0, -1)
          .exec();
        size = queueSize;
        const gameId = await createNewGame(player1, player2);
        await updateOnRedisHMap(player1, { gameId });
        await updateOnRedisHMap(player2, { gameId });
        await sendGameStartEvent(player1);
        await sendGameStartEvent(player2);
      }
    }
  }, 500);


  async function createNewGame(playerId1, playerId2) {
    console.log(`Worker ${process.pid} serving`);
    console.log('create new game');
    const game = {
      id: uuidv1(),
      players: [],
      board: Array(3).fill(3).map(() => Array(3)),
      currentTurn: playerId1,
      status: 'ONGOING',
      winner: null
    }
    game.players.push({
      id: playerId1,
      identifier: 'X',
    });
    game.players.push({
      id: playerId2,
      identifier: 'O'
    });
    await insertOnRedisHMap(game.id, game);
    return game.id;
  }

  async function sendGameStartEvent(playerId) {
    const playerDetails = await getFromRedisHMap(playerId);
    const socketId = playerDetails.socketId;
    const gameId = playerDetails.gameId;
    const game = await getFromRedisHMap(gameId);
    io.sockets.to(socketId).emit('game_started', {
      identifier: game.players.find(item => item.id === playerId).identifier,
      opponentId: game.players.find(item => item.id !== playerId).id,
      board: game.board,
      isMyTurn: playerId === game.currentTurn
    });
  }

  async function broadCastGamePlayEvent(data) {
    console.log(`Worker ${process.pid} serving`);
    const playerDetails = await getFromRedisHMap(data.userId);
    const gameId = playerDetails.gameId;
    const game = await getFromRedisHMap(gameId);
    const opponent = game.players.find(item => item.id !== data.userId).id;
    const opponentDetails = await getFromRedisHMap(opponent);
    const socketId = opponentDetails.socketId;
    io.sockets.to(socketId).emit('game_play', {
      position: data.position,
      isMyTurn: true,
      gameIdentifier: game.players.find(item => item.id === data.userId).identifier
    });
  }

  /* redis code starts*/
  const insertOnRedisHMap = async (key, value) => {
    await client.set(mapPrefix + key, JSON.stringify(value));
  }

  const updateOnRedisHMap = async (key, value) => {
    const previousData = await client.get(mapPrefix + key);
    await client.set(mapPrefix + key, JSON.stringify({ ...JSON.parse(previousData), ...value }));
  }

  const getFromRedisHMap = async (key) => {
    const data = await client.get(mapPrefix + key);
    return JSON.parse(data);
  }

  const removeFromRedisHMap = async (key) => {
    const data = await client.del(mapPrefix + key);
    return data;
  }

  const isRecordExistsOnRedisHMap = async (key) => {
    const data = await client.exists(mapPrefix + key);
    return data;
  }

  const enqueue = async (key, value) => {
    const result = await client.rPush(mapPrefix + key, value);
    return result;
  }

  const dequeue = async (key) => {
    const result = await client.lPop(mapPrefix + key);
    return result;
  }

  const getQueueSize = async (key) => {
    const result = await client.lRange(mapPrefix + key, 0, -1);
    return result.length;
  }

  /*redis code ends*/
}

if (cluster.isMaster) {
  const server = require('http').createServer(app);
  new RateLimiterClusterMaster();

  setupMaster(server, {
    loadBalancingMethod: "least-connection",
  });
  setupPrimary();

  server.listen(3000);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });
} else {
  initGame();
}
