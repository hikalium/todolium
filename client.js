import { mergeChains, deriveState } from './engine.js';

const DAY = 24 * 60 * 60 * 1000;

// --- Device ID ---
let deviceId = localStorage.getItem('todolium_device_id');
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem('todolium_device_id', deviceId);
}

// --- Event store ---
function loadEvents() {
  try {
    return JSON.parse(localStorage.getItem('todolium_events') ?? '[]');
  } catch { return []; }
}

function getTaskTip(events, taskId) {
  const taskEvents = events.filter(e => e.task_id === taskId);
  const parentEids = new Set(taskEvents.map(e => e.parent_eid).filter(Boolean));
  const tips = taskEvents.filter(e => !parentEids.has(e.eid));
  return tips.length > 0 ? tips[0].eid : null;
}

function appendAndRender(event) {
  const events = loadEvents();
  events.push(event);
  localStorage.setItem('todolium_events', JSON.stringify(events));
  render(deriveState(mergeChains(events, [])));
}

function makeEvent(type, taskId, parentEid, extra = {}) {
  return { eid: crypto.randomUUID(), type, at: Date.now(), device_id: deviceId, task_id: taskId, parent_eid: parentEid, ...extra };
}

// --- Actions ---
function addTodo(text) {
  const task_id = crypto.randomUUID();
  appendAndRender(makeEvent('add_todo', task_id, null, { task: text }));
}

function markAsDone(taskId) {
  const tip = getTaskTip(mergeChains(loadEvents(), []), taskId);
  if (tip) appendAndRender(makeEvent('mark_done', taskId, tip));
}

function postpone(taskId, ms) {
  const tip = getTaskTip(mergeChains(loadEvents(), []), taskId);
  if (tip) appendAndRender(makeEvent('postpone', taskId, tip, { ms }));
}

function revertTask(taskId) {
  const tip = getTaskTip(mergeChains(loadEvents(), []), taskId);
  if (tip) appendAndRender(makeEvent('revert', taskId, tip));
}

// --- Duration formatting ---
const fmt = humanizeDuration.humanizer({
  language: 'shortEn',
  languages: {
    shortEn: {
      y: () => 'y', mo: () => 'mo', w: () => 'w', d: () => 'd',
      h: () => 'h', m: () => 'm', s: () => 's', ms: () => 'ms',
    },
  },
});
const fmtOpts = { units: ['d', 'h', 'm', 's'], round: true, spacer: '', largest: 2, delimiter: '' };
const absDur = (d) => fmt(d, fmtOpts);
const relDur = (d) => (d < 0 ? '-' : '+') + fmt(Math.abs(d), fmtOpts);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Render ---
function render(state) {
  const now = Date.now();

  document.getElementById('done_list').innerHTML = state.done_list.slice(0, 3).map(t => `
    <div class="todolium-task todolium-task-done">
      <button onclick="revertTask('${t.task_id}')">revert</button>
      <span class="todolium-span-task">${esc(t.task)}</span>
      <span class="todolium-span-completion-info">${new Date(t.done_at).toISOString()}, Took ${absDur(t.done_at - t.created_at)}</span>
    </div>
  `).join('');

  document.getElementById('todo_list').innerHTML = state.todo_list.map(t => {
    const d = t.deadline - now;
    const cls = d >= 0 ? 'todolium-span-duration' : 'todolium-span-duration-behind';
    return `
      <div class="todolium-task todolium-task-todo">
        <button onclick="markAsDone('${t.task_id}')">Done!</button>
        <button onclick="postpone('${t.task_id}', ${1 * DAY})">+1d</button>
        <button onclick="postpone('${t.task_id}', ${2 * DAY})">+2d</button>
        <button onclick="postpone('${t.task_id}', ${4 * DAY})">+4d</button>
        <button onclick="postpone('${t.task_id}', ${8 * DAY})">+8d</button>
        <span class="${cls}">${relDur(d)}</span>
        <span class="todolium-span-task">${esc(t.task)}</span>
      </div>
    `;
  }).join('');
}

// Expose for inline onclick handlers
window.markAsDone = markAsDone;
window.postpone = postpone;
window.revertTask = revertTask;

// --- Input handler ---
const inputbox = document.getElementById('inputbox');
inputbox.addEventListener('keydown', (e) => {
  if (e.isComposing || e.key !== 'Enter') return;
  const text = inputbox.value.trim();
  if (!text) return;
  addTodo(text);
  inputbox.value = '';
});

// --- Initial render ---
render(deriveState(mergeChains(loadEvents(), [])));
