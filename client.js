const socket = io();
const inputbox = document.getElementById('inputbox');
const done_list = document.getElementById('done_list');
const todo_list = document.getElementById('todo_list');

const durationString = humanizeDuration.humanizer({
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
const absDurationString = (() => {
  return (d) => {
    return durationString(d, {
      units: ['d', 'h', 'm', 's'],
      round: true,
      spacer: '',
      largest: 2,
      delimiter: '',
    });
  }
})();
const relDurationString = (() => {
  return (d) => {
    return (d < 0 ? '-' : '+') + durationString(d, {
             units: ['d', 'h', 'm', 's'],
             round: true,
             spacer: '',
             largest: 2,
             delimiter: '',
           });
  }
})();
const markAsDone = (id) => {
  socket.emit('mark_as_done', id);
};

socket.on('list_done', (list) => {
  list = JSON.parse(list).map(e => {
    e.created_at = new Date(e.created_at);
    e.done_at = new Date(e.done_at);
    return e;
  });
  console.log('list_completed:', list);
  done_list.innerHTML = '';
  for (e of list) {
    done_list.innerHTML += `
      <div id="task${e.id}" class="todolium-task todolium-task-done">
        <button>revert</button>
        <span class="todolium-span-task">
          ${e.task}
        </span>
        <span class="todolium-span-completion-info">${
        e.done_at.toISOString()}, Took ${
        absDurationString(e.done_at.getTime() - e.created_at.getTime())}</span>
        </span>
      </div>
    `;
  }
});



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
    const d = e.deadline.getTime() - now.getTime();
    const duration_class =
        (d >= 0) ? 'todolium-span-duration' : 'todolium-span-duration-behind';
    todo_list.innerHTML += `
      <div id="task${e.id}" class="todolium-task todolium-task-todo">
        <button onclick="markAsDone(${e.id});">Done!</button>
        <button>+1d</button>
        <button>+2d</button>
        <button>+4d</button>
        <button>+8d</button>
        <span class="${duration_class}">${relDurationString(d)}</span>
        <span class="todolium-span-task">
          ${e.task}
        </span>
      </div>
    `;
  }
});

inputbox.addEventListener('keydown', (e) => {
  if (e.isComposing) {
    return;
  }
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
