import assert from 'assert';
import express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
var __filename = fileURLToPath(import.meta.url);
var todoliumRootPath = path.dirname(path.dirname(__filename));
console.log(typeof express);
var app = express();
var server = http.createServer(app);
var io = new Server(server);
var todo_list;
var done_list;
var next_id;
var loadData = function () {
    /*
     {
        id: integer, unique id for the tasks,
        task: string, name of the task,
        created_at: integer, ms timestamp,
        deadline: integer, ms timestamp,
        ?done_at: integer, ms timestamp,
     }
     */
    var json = fs.readFileSync('todo.json', 'utf-8');
    var data = JSON.parse(json);
    assert(data.todo_list !== undefined);
    assert(data.done_list !== undefined);
    todo_list = data.todo_list;
    done_list = data.done_list;
    next_id = todo_list.concat(done_list).reduce(function (max, e) { return max > e.id ? max : e.id; }, 0);
    console.log("next_id: ".concat(next_id));
};
var updateData = function (socket) {
    done_list.sort(function (l, r) { return r.done_at - l.done_at; });
    todo_list.sort(function (l, r) { return l.deadline - r.deadline; });
    var data = {
        todo_list: todo_list,
        done_list: done_list
    };
    fs.writeFileSync('todo.json', JSON.stringify(data));
    socket.emit('list_todo', JSON.stringify(todo_list));
    socket.emit('list_done', JSON.stringify(done_list.slice(0, 3)));
};
loadData();
app.get('/', function (_req, res) {
    res.sendFile(todoliumRootPath + '/index.html');
});
app.get('/index.css', function (_req, res) {
    res.sendFile(todoliumRootPath + '/index.css');
});
app.get('/client.js', function (_req, res) {
    res.sendFile(todoliumRootPath + '/client.js');
});
app.get('/humanize-duration.js', function (_req, res) {
    res.sendFile(todoliumRootPath + '/node_modules/humanize-duration/humanize-duration.js');
});
io.on('connection', function (socket) {
    console.log('a user connected');
    updateData(socket);
    socket.on('new_todo', function (s) {
        console.log('new_todo: ' + s);
        var t = {
            id: next_id++,
            task: s,
            created_at: new Date().getTime(),
            deadline: new Date((new Date).getTime() + 1000 * 60 * 60 * 24).getTime()
        };
        console.log(t);
        todo_list.push(t);
        updateData(socket);
    });
    socket.on('mark_as_done', function (id) {
        console.log("mark_as_done: ".concat(id));
        var idx = todo_list.findIndex(function (e) { return e.id == id; });
        if (idx < 0) {
            console.log('Not found');
            return;
        }
        var t = todo_list[idx];
        todo_list.splice(idx, 1);
        t.done_at = new Date().getTime();
        console.log(t);
        done_list.push(t);
        updateData(socket);
    });
    socket.on('postpone', function (id, ms) {
        console.log("postpone: ".concat(id, " ").concat(ms));
        var idx = todo_list.findIndex(function (e) { return e.id == id; });
        if (idx < 0) {
            console.log('Not found');
            return;
        }
        todo_list[idx].deadline = new Date().getTime() + ms;
        updateData(socket);
    });
});
server.listen(3000, function () {
    console.log('listening on *:3000');
});
//# sourceMappingURL=server.js.map