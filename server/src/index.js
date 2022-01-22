const app = require('express')();
var cors = require('cors');
app.use(cors);
const { v1: uuidv1 } = require('uuid');

const server = require('http').createServer(app);

const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  }
});

const userMap = new Map();
const waitingQueue = [];
const gameMap = new Map();

io.sockets.on('connection', (socket) => {
  socket.on('clientDetails', (data) => {
    console.log('client login details', data);
    if (!userMap.has(data.email)) {
      userMap.set(data.email, { socketId: socket.id, gameId: null });
      waitingQueue.push(data.email);
    }
  });
  socket.on('user_move', (data) => {
    broadCastGamePlayEvent(data);
  });
});

setInterval(() => {
  if (waitingQueue.length >= 2) {
    while (waitingQueue.length >= 2) {
      const player1 = waitingQueue.shift();
      const player2 = waitingQueue.shift();
      const gameId = createNewGame(player1, player2);
      userMap.get(player1).gameId = gameId;
      userMap.get(player2).gameId = gameId;
      sendGameStartEvent(player1);
      sendGameStartEvent(player2);
    }
  }
}, 500);

server.listen(3000);

function createNewGame(playerId1, playerId2) {
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
  gameMap.set(game.id, game);
  return game.id;
}

function sendGameStartEvent(playerId) {
  const socketId = userMap.get(playerId).socketId;
  const gameId = userMap.get(playerId).gameId;
  const game = gameMap.get(gameId);
  io.sockets.to(socketId).emit('game_started', {
    identifier: game.players.find(item => item.id === playerId).identifier,
    opponentId: game.players.find(item => item.id !== playerId).id,
    board: game.board,
    isMyTurn: playerId === game.currentTurn
  });
}

function broadCastGamePlayEvent(data) {
  const gameId = userMap.get(data.userId).gameId;
  const game = gameMap.get(gameId);
  const opponent = game.players.find(item=> item.id !== data.userId).id;
  const socketId = userMap.get(opponent).socketId;
  io.sockets.to(socketId).emit('game_play', {
    position: data.position,
    isMyTurn: true,
    gameIdentifier: game.players.find(item=> item.id === data.userId).identifier
  });
}