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

io.on('connection', (_socket) => {
  console.log('a user connected');
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
