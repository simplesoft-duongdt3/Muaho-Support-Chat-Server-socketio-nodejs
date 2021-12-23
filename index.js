import express from 'express';
import { createServer } from 'http';
import { SqliteMessageStore, Message } from './message_store.js';
import jwt from 'jsonwebtoken';
import { Server } from "socket.io";

// Rooms
const cs_room = "cs_room";
const open_chat_session_cs_room = "open_chat_session_cs_room";
const open_chat_session_users_room = "open_chat_session_users_room";

//Emit event
const emit_event_remove_chat_session_user = 'remove_chat_session_user';
const emit_event_new_chats = 'new_chats';
const emit_event_open_chat_session_success = 'open_chat_session_success';
const emit_event_open_session_users = 'open_session_users';
const emit_event_add_chat_session_user = 'add_chat_session_user';
const emit_event_chat_history = 'chats_history';

//On event
const on_event_chat = 'chat';
const on_event_open_chat_session = 'open_chat_session';
const on_event_close_chat_session = 'close_chat_session';

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
    var socketTicket = io.sockets.sockets.get(id);
    console.log(`socket ${id} has leaved room ${room} userId ${socketTicket.userId}`);
    
    if(open_chat_session_users_room == room) {
      io.to(cs_room).emit(emit_event_remove_chat_session_user, { userId: socketTicket.userId });
    }
  });

  io.on('connection', async (socket) => {
    console.log('connection ' + socket.id);
    
    socket.on(on_event_chat, (msg) => {
      on_event_chat_handler(checkIsCs, socket, msg, messageStore, io);
    });

    socket.on(on_event_open_chat_session, async (ticket) => {
      await on_event_open_chat_session_handler(socket, ticket, checkIsCs, io, messageStore);
    });

    socket.on(on_event_close_chat_session, () => {
      on_event_close_chat_session_handler(socket, checkIsCs);
    });

    socket.on('ping', () => {
      console.log('user ping ' + socket.id);
    });

    socket.on('disconnect', () => {
      console.log('user disconnected ' + socket.id);
    });
  });


  server.listen(3000, () => {
    console.log('listening on *:3000');
  });
}

main();

async function on_event_open_chat_session_handler(socket, ticket, checkIsCs, io, messageStore) {
  console.log('open_chat_session ' + socket.id + " ticket " + JSON.stringify(ticket));
  var isCs = checkIsCs(socket);
  socket.userName = ticket.name;
  io.to(socket.id).emit(emit_event_open_chat_session_success, { userId: socket.userId, userName: socket.userName, isCs: isCs });

  if (isCs) {
    socket.join(open_chat_session_cs_room);
    socket.join(cs_room);
    const sockets = await io.in(open_chat_session_users_room).allSockets();
    const tickets = new Map();

    for (const socketId of sockets) {
      var socketTicket = io.sockets.sockets.get(socketId);
      tickets.set(socketTicket.userId, {
        userId: socketTicket.userId,
        userName: socketTicket.userName,
      });
    }
    var arrayTickets = Array.from(tickets.values());
    io.to(socket.id).emit(emit_event_open_session_users, arrayTickets);
    console.log('emit_event_open_session_users ' + JSON.stringify(tickets));
  } else {
    socket.join(open_chat_session_users_room);
    io.to(cs_room).emit(emit_event_add_chat_session_user, { userId: socket.userId, userName: socket.userName });

    socket.join(get_user_room_by_id(socket.userId));

    //latest 50 msg + isMore (query 51 msg) -> client call API to get more msg
    var count = 50;
    const msgList = await messageStore.findMessagesForUser(socket.userId, count + 1);
    io.to(socket.id).emit(emit_event_chat_history, {
      msgList: msgList.slice(0, count + 1),
      isMore: msgList.length > count
    });
  }
}

function on_event_close_chat_session_handler(socket, checkIsCs) {
  console.log('close_chat_session ' + socket.id);
  var isCs = checkIsCs(socket);
  if (isCs) {
    socket.leave(open_chat_session_cs_room);
  } else {
    socket.leave(open_chat_session_users_room);
  }
}

function on_event_chat_handler(checkIsCs, socket, msg, messageStore, io) {
  var isCs = checkIsCs(socket);
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
  io.to(get_user_room_by_id(roomId)).to(cs_room).emit(emit_event_new_chats, [message]);
}

function get_user_room_by_id(userId) {
  return "room_user_" + userId;
}
// token cs 
// eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo5OTk5OTksInJvbGUiOiJjcyIsImlhdCI6MTYzODg4NTkwOCwiZXhwIjoxNjQyODA5OTA4fQ.jnfKxpR0fxwdCg-rEqpJc1xIWNiaozEq4a0WkRGK624
// tokenBuyer
// eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo5OTk5OTgsInJvbGUiOiJidXllciIsImlhdCI6MTYzODg4NTkwOCwiZXhwIjoxNjQ2OTIxMTA4fQ.VSwq6aFH_p6XeeqKs6iy666JwyPZMxvYU2KYVMaqEiI

//get token for testing
// var tokenCs = jwt.sign({
//   "user_id": 999999, 
//   "role": "cs", 
// }, "asd*(askldmnasKL8902", { expiresIn: '1090h' });
// var tokenBuyer = jwt.sign({
//   "user_id": 999998, 
//   "role": "buyer", 
// }, "asd*(askldmnasKL8902", { expiresIn: '2232h' });

// console.log("token cs " + tokenCs + " tokenBuyer " + tokenBuyer);

// try {
//   var decodedCs = jwt.verify(tokenCs, "asd*(askldmnasKL8902");
//   var decodedBuyer = jwt.verify(tokenBuyer, "asd*(askldmnasKL8902");

//   console.log("decodedCs " + JSON.stringify(decodedCs) + " decodedBuyer " + JSON.stringify(decodedBuyer));
// } catch(err) {
//   // err
// }