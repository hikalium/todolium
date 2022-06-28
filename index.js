import assert from 'assert';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {Server} from 'socket.io';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

let todo_list;
let done_list;
let next_id;

const loadData = () => {
  /*
   {
      id: integer, unique id for the tasks,
      task: string, name of the task,
      created_at: integer, ms timestamp,
      deadline: integer, ms timestamp,
      ?done_at: integer, ms timestamp,
   }
   */
  const json = fs.readFileSync('todo.json', 'utf-8');
  const data = JSON.parse(json);
  assert(data.todo_list !== undefined);
  assert(data.done_list !== undefined);
  todo_list = data.todo_list;
  done_list = data.done_list;
  next_id = todo_list.concat(done_list).reduce(
      (max, e) => max > e.id ? max : e.id, 0);
  console.log(`next_id: ${next_id}`);
};
const updateData = (socket) => {
  done_list.sort((l, r) => {return r.done_at - l.done_at});
  todo_list.sort((l, r) => {return l.deadline - r.deadline});
  const data = {
    todo_list: todo_list,
    done_list: done_list,
  };
  fs.writeFileSync('todo.json', JSON.stringify(data));
  socket.emit('list_todo', JSON.stringify(todo_list));
  socket.emit('list_done', JSON.stringify(done_list.slice(0, 3)));
};

loadData();
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
  res.sendFile(
      __dirname + '/node_modules/humanize-duration/humanize-duration.js');
});
io.on('connection', (socket) => {
  console.log('a user connected');
  updateData(socket);
  socket.on('new_todo', (s) => {
    console.log('new_todo: ' + s);
    let t = {
      id: next_id++,
      task: s,
      created_at: new Date().getTime(),
      deadline: new Date((new Date).getTime() + 1000 * 60 * 60 * 24).getTime(),
    };
    console.log(t);
    todo_list.push(t);
    updateData(socket);
  });
  socket.on('mark_as_done', (id) => {
    console.log(`mark_as_done: ${id}`);
    const idx = todo_list.findIndex((e) => e.id == id);
    if( idx < 0 ){
      console.log("Not found");
      return;
    }
    const t = todo_list[idx];
    todo_list.splice(idx, 1);
    t.done_at =  new Date().getTime();
    console.log(t);
    done_list.push(t)
    updateData(socket);
  });
});
server.listen(3000, () => {
  console.log('listening on *:3000');
});
