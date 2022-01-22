var app = new Vue({
  el: '#app',
  data: {
    userInput: '',
    userId: '',
    displayLabel: '',
    loggedIn: false,
    socket,
    gameIdentifier: '',
    board: Array(3).fill('').map(()=>Array(3)),
    isMyTurn: false,
    opponentId: null,
  },
  methods: {
    joinGame() {
      console.log('connection initiated');
      this.userId = this.userInput;
      this.displayLabel = `You are logged in as ${this.userId}`;
      this.socket = initSocketClient(this.userId);
      this.initSocketListeners();
      this.loggedIn = true;
      this.userInput = '';
    },
    initSocketListeners() {
      socket.on("game_started", (data) => {
        this.gameIdentifier = data.identifier;
        this.isMyTurn = data.isMyTurn;
        this.opponentId = data.opponentId;
      });

      socket.on("game_play", (data) => {
        const position = data.position;
        app.$set(app.board[position.row], position.column, data.gameIdentifier);
        this.isMyTurn = data.isMyTurn;  
      });
    },
    tileClicked(i, j) {
      if(this.isMyTurn) {
        socket.emit("user_move", {
          userId: this.userId,
          position : {
            row: i,
            column: j
          }
        });
        app.$set(app.board[i], j, this.gameIdentifier);
        this.isMyTurn = false;
      }
    }
  }
});