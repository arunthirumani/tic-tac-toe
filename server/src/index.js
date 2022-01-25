const app = require('express')();
var cors = require('cors');
app.use(cors);
const { v1: uuidv1 } = require('uuid');
const redis = require('redis');

/* redis code starts*/
const client = redis.createClient();
client.connect();

client.on('ready', (data) => {
  console.log('redis connection successful');
});

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

const server = require('http').createServer(app);

const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  }
});
const mapPrefix = 'at-tic-tac-toe:';


io.sockets.on('connection', (socket) => {
  socket.on('clientDetails', async (data) => {
    console.log('client login details', data);
    const isUserAlreadyExists = await isRecordExistsOnRedisHMap(data.email);
    if (!isUserAlreadyExists) {
      insertOnRedisHMap(data.email, { socketId: socket.id, gameId: null });
      await enqueue('queue', data.email);
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
      const player1 = await dequeue('queue');
      const player2 = await dequeue('queue');
      const gameId = await createNewGame(player1, player2);
      await updateOnRedisHMap(player1, { gameId });
      await updateOnRedisHMap(player2, { gameId });
      await sendGameStartEvent(player1);
      await sendGameStartEvent(player2);
      size = await getQueueSize();
    }
  }
}, 500);

server.listen(3000);

async function createNewGame(playerId1, playerId2) {
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
  console.log(playerId);
  const playerDetails = await getFromRedisHMap(playerId);
  console.log(playerDetails);
  const socketId = playerDetails.socketId;
  const gameId = playerDetails.gameId;
  const game = await getFromRedisHMap(gameId);
  console.log(game);
  io.sockets.to(socketId).emit('game_started', {
    identifier: game.players.find(item => item.id === playerId).identifier,
    opponentId: game.players.find(item => item.id !== playerId).id,
    board: game.board,
    isMyTurn: playerId === game.currentTurn
  });
}

async function broadCastGamePlayEvent(data) {
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


// (async () => {
//   await insertOnRedis('test@test.com', {socketId: '', gameId: ''});
//   const data = await getFromRedis('test@test.com');
//   console.log(data);
//   await updateOnRedis('test@test.com', {gameId: '123'});
//   const updatedData = await getFromRedis('test@test.com');
//   console.log(updatedData);
//   const removeResult = await removeFromRedis('test@test.com');
//   console.log(removeResult);
// })();