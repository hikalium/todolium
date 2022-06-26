const socket = io();
const inputbox = document.getElementById('inputbox');
const completed_list = document.getElementById('completed_list');
const todo_list = document.getElementById('todo_list');

const durationString = (() => {
  const f = humanizeDuration.humanizer({
    language: 'shortEn',
    languages: {
      shortEn: {
        y: () => 'y',
        mo: () => 'mo',
        w: () => 'w',
        d: () => 'd',
        h: () => 'h',
        m: () => 'm',
        s: () => 's',
        ms: () => 'ms',
      },
    },
  });
  return (d) => {
    return (d < 0 ? '-' : '+') + f(d, {
             units: ['d', 'h', 'm', 's'],
             round: true,
             spacer: '',
             largest: 2,
             delimiter: '',
           });
  }
})();

socket.on('list_todo', (list) => {
  const now = new Date;
  list = JSON.parse(list).map(e => {
    e.created_at = new Date(e.created_at);
    e.deadline = new Date(e.deadline);
    return e;
  });
  console.log('list_todo:', list);
  todo_list.innerHTML = '';
  for (e of list) {
    todo_list.innerHTML += `
      <div id="task${e.id}" class="todolium-task-entry todolium-task-todo">
        <button>Done!</button>
        <button>+1d</button>
        <button>+2d</button>
        <button>+4d</button>
        <button>+8d</button>
        <span class="todolium-span-duration">${
        durationString(now.getTime() - e.created_at.getTime())}</span>
        <span class="todolium-span-duration">${
        durationString(e.deadline.getTime() - now.getTime())}</span>
        <span class="todolium-span-task">
          ${e.task}
        </span>
      </div>
    `;
  }
});

inputbox.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') {
    return;
  }
  const todoText = inputbox.value.trim();
  if (todoText.length === 0) {
    return;
  }
  socket.emit('new_todo', todoText);
  inputbox.value = '';
});
