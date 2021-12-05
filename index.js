import express from 'express';
import { createServer } from 'http';
import { SqliteMessageStore, Message } from './message_store.js';
import jwt from 'jsonwebtoken';
import { Server } from "socket.io";

async function main() {
  const app = express();
  const server = createServer(app);
  const io = new Server(server);


  const messageStore = new SqliteMessageStore();
  await messageStore.init();
  app.use('/', express.static('static'))

  //role 1: CS (multi account)
  //role 2: user - buyer (multi account)

  // user1 -> ask `question 1`
  // 3 CS online => 3 cs will see `question 1`
  // Cs1 -> reply user1 about `question 1`
  // In group user: only user1 -> will see reply `question 1`
  // In group cs: cs2, cs3 -> will see reply `question 1`

  function checkIsCs(socket) {
    return socket.role == "cs";
  }

  // interceptor
  //get userId, check token expired -> JWT token
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("invalid user, need login"));
    }
    try {
      var decodedUser = jwt.verify(token, "asd*(askldmnasKL8902");
      socket.userId = decodedUser.user_id;
      socket.role = decodedUser.role;

      console.log("socket.userId: " + socket.userId + " socket.role: " + socket.role + " socket.id: " + socket.id)
    } catch (err) {
      return next(new Error("invalid user, need login"));
    }

    next();
  });

  io.of("/").adapter.on("create-room", (room) => {
    console.log(`room ${room} was created`);
  });

  io.of("/").adapter.on("join-room", (room, id) => {
    console.log(`socket ${id} has joined room ${room}`);
  });
  io.of("/").adapter.on("leave-room", (room, id) => {
    console.log(`socket ${id} has leaved room ${room}`);
  });

  io.on('connection', async (socket) => {
    console.log('connection ' + socket.id);
    var isCs = checkIsCs(socket)

    if (isCs) {
      socket.join("room_cs");
      const ids = await io.in("open_ticket_users").allSockets();
      var tickets = [];
      for (const id in ids) {
        var socket = io.sockets.sockets.get(id);
        tickets.push({
          userId: socket.userId,
          userName: socket.userName,
        });
      }
      io.to(socket.id).emit('old_tickets', tickets)
    } else {
      socket.join("room_user_" + socket.userId);

      //latest 50 msg + isMore (query 51 msg) -> client call API to get more msg
      var count = 50
      const msgList = await messageStore.findMessagesForUser(socket.userId, count + 1)
      io.to(socket.id).emit('old_news', {
        msgList: msgList.slice(0, count + 1),
        isMore: msgList.length > count
      })
    }

    socket.on('chat', (msg) => {
      console.log('chat ' + socket.id + " msg " + JSON.stringify(msg));
      var roomId = socket.userId;
      if (isCs) {
        roomId = msg.receiverUserId;
      }

      //client msg id improve UX, check status of sending msg
      //msg.msg_uid

      var message = new Message(
        socket.userId, msg.receiverUserId, msg.msg, roomId
      );

      messageStore.saveMessage(message);
      io.to("room_user_" + roomId).to("room_cs").emit('news', [message]);
    });

    socket.on('open_ticket', (ticket) => {
      console.log('open_ticket ' + socket.id + " ticket " + JSON.stringify(ticket));
      var isCs = checkIsCs(socket)
      if (!isCs) {
        socket.userName = ticket.name;
        socket.join("open_ticket_users");
        io.to("room_cs").emit('add_ticket_user', { userId: socket.userId, userName: socket.userName });
      }
    });

    socket.on('close_ticket', () => {
      console.log('close_ticket ' + socket.id);
      var isCs = checkIsCs(socket)
      if (!isCs) {
        socket.leave("open_ticket_users");
        io.to("room_cs").emit('remove_ticket_user', { userId: socket.userId });
      }
    });

    socket.on('disconnect', () => {
      console.log('user disconnected');
    });
  });


  server.listen(3000, () => {
    console.log('listening on *:3000');
  });
}

main();

//token cs 
//eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMDEsInJvbGUiOiJjcyIsImlhdCI6MTYzODY2ODczMywiZXhwIjoxNjM4NjcyMzMzfQ.Lw3rijtR5onuK_fsrsiyrF7yXKb_yuC3dzrRu1pEanA
//tokenBuyer 
//eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxMDAsInJvbGUiOiJidXllciIsImlhdCI6MTYzODY2ODczMywiZXhwIjoxNjM4Njc1OTMzfQ.leC62ujxj8ikGblQ72oBbg1qBMWlpCH-Nih4oIntSBU

//get token for testing
// var tokenCs = jwt.sign({
//   "user_id": 101, 
//   "role": "cs", 
// }, "asd*(askldmnasKL8902", { expiresIn: '1h' });
// var tokenBuyer = jwt.sign({
//   "user_id": 100, 
//   "role": "buyer", 
// }, "asd*(askldmnasKL8902", { expiresIn: '2h' });

// console.log("token cs " + tokenCs + " tokenBuyer " + tokenBuyer);

// try {
//   var decodedCs = jwt.verify(tokenCs, "asd*(askldmnasKL8902");
//   var decodedBuyer = jwt.verify(tokenBuyer, "asd*(askldmnasKL8902");

//   console.log("decodedCs " + JSON.stringify(decodedCs) + " decodedBuyer " + JSON.stringify(decodedBuyer));
// } catch(err) {
//   // err
// }