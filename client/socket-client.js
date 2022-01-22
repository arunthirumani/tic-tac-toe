let socket;

const initSocketClient = (userId) => {
  socket = io("ws://localhost:3000");

  socket.on("connect", (data) => {
    socket.emit("clientDetails", { email: userId });
  });
  
  return socket;
}

