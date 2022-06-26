import express from 'express';
import http from 'http';
import path from 'path';
import {Server} from 'socket.io';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (_req, res) => {
  res.sendFile(__dirname + '/index.html');
});
app.get('/index.css', (_req, res) => {
  res.sendFile(__dirname + '/index.css');
});
app.get('/client.js', (_req, res) => {
  res.sendFile(__dirname + '/client.js');
});
app.get('/humanize-duration.js', (_req, res) => {
  res.sendFile(__dirname + '/node_modules/humanize-duration/humanize-duration.js');
});

const todo_list = [
  {
    id: 1,
    task: "first item",
    created_at: Date.parse("2022-06-26T12:00:00.000+09:00"),
    deadline: Date.parse("2022-06-26T12:00:00.000+09:00"),
  },
  {
    id: 2,
    task: "second item",
    created_at: Date.parse("2022-06-26T12:05:00.000+09:00"),
    deadline: Date.parse("2022-06-26T12:00:00.000+09:00"),
  },
  {
    id: 3,
    task: "third item",
    created_at: Date.parse("2022-06-26T12:10:00.000+09:00"),
    deadline: Date.parse("2022-06-27T12:00:00.000+09:00"),
  },
];
const done_list = [
  {
    id: 5,
    task: "first item done",
    created_at: Date.parse("2022-06-26T12:00:00.000+09:00"),
    done_at: Date.parse("2022-06-26T12:30:00.000+09:00"),
  },
  {
    id: 6,
    task: "second item done",
    created_at: Date.parse("2022-06-26T12:05:00.000+09:00"),
    done_at: Date.parse("2022-06-26T13:00:00.000+09:00"),
  },
  {
    id: 7,
    task: "third item done",
    created_at: Date.parse("2022-06-01T12:10:00.000+09:00"),
    done_at: Date.parse("2022-06-27T12:00:00.000+09:00"),
  },
];

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.emit('list_todo', JSON.stringify(todo_list));
  socket.emit('list_done', JSON.stringify(done_list));
  socket.on('new_todo', (s) => {
    console.log('new_todo: ' + s);
  });
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
