import { mergeChains, deriveState, calculateInsertionDeadline } from './engine.js';

const DAY = 24 * 60 * 60 * 1000;
const SYNC_INTERVAL_MS = 5000;

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

function saveAndRender(events) {
  localStorage.setItem('todolium_events', JSON.stringify(events));
  render(deriveState(mergeChains(events, [])));
}

function appendAndRender(event) {
  const events = loadEvents();
  events.push(event);
  saveAndRender(events);
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

// --- Server sync ---
let online = false;

function setOnlineStatus(isOnline) {
  if (online === isOnline) return;
  online = isOnline;
  const indicator = document.getElementById('sync_status');
  if (indicator) {
    indicator.textContent = online ? '● synced' : '○ offline';
    indicator.className = online ? 'sync-online' : 'sync-offline';
  }
}

async function syncWithServer() {
  try {
    const res = await fetch('/api/events');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serverEvents = await res.json();
    const localEvents = loadEvents();
    const merged = mergeChains(localEvents, serverEvents);

    // Push events the server doesn't have
    const serverEids = new Set(serverEvents.map(e => e.eid));
    const toSend = merged.filter(e => !serverEids.has(e.eid));
    if (toSend.length > 0) {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSend),
      });
    }

    saveAndRender(merged);
    setOnlineStatus(true);
  } catch {
    setOnlineStatus(false);
  }
}

// --- Duration formatting ---
function formatDuration(ms) {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.slice(0, 2).join('') || '0s';
}
const absDur = (ms) => formatDuration(ms);
const relDur = (ms) => (ms < 0 ? '-' : '+') + formatDuration(ms);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Drag-to-reorder ---
let dragState = null; // { taskId, sourceIndex, indicatorEl }

function setupDrag(todoListEl, todoList) {
  let indicatorEl = null;

  function getDropIndex(clientY) {
    const items = [...todoListEl.querySelectorAll('.todolium-task-todo')];
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return items.length;
  }

  function showIndicator(dropIndex) {
    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'todolium-drop-indicator';
    }
    const items = [...todoListEl.querySelectorAll('.todolium-task-todo')];
    if (items.length === 0) return;
    if (dropIndex < items.length) {
      todoListEl.insertBefore(indicatorEl, items[dropIndex]);
    } else {
      todoListEl.appendChild(indicatorEl);
    }
  }

  function removeIndicator() {
    if (indicatorEl && indicatorEl.parentNode) {
      indicatorEl.parentNode.removeChild(indicatorEl);
    }
    indicatorEl = null;
  }

  todoListEl.querySelectorAll('.todolium-drag-handle').forEach((handle, sourceIndex) => {
    const taskId = handle.dataset.taskId;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      dragState = { taskId, sourceIndex };
      handle.closest('.todolium-task').style.opacity = '0.5';
      showIndicator(sourceIndex);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragState || dragState.taskId !== taskId) return;
      const dropIndex = getDropIndex(e.clientY);
      showIndicator(dropIndex);
    });

    handle.addEventListener('pointerup', (e) => {
      if (!dragState || dragState.taskId !== taskId) return;
      const dropIndex = getDropIndex(e.clientY);
      removeIndicator();
      handle.closest('.todolium-task').style.opacity = '';
      dragState = null;

      // Skip if dropped on same position
      if (dropIndex === sourceIndex || dropIndex === sourceIndex + 1) return;

      const above = todoList[dropIndex - 1] ?? null;
      const below = todoList[dropIndex] ?? null;
      // Exclude the dragged task itself from neighbor computation
      const aboveAdj = above && above.task_id === taskId ? (todoList[dropIndex - 2] ?? null) : above;
      const belowAdj = below && below.task_id === taskId ? (todoList[dropIndex + 1] ?? null) : below;
      const targetDeadline = calculateInsertionDeadline(aboveAdj, belowAdj);
      const ms = targetDeadline - Date.now();
      postpone(taskId, ms);
    });

    handle.addEventListener('pointercancel', () => {
      if (!dragState || dragState.taskId !== taskId) return;
      removeIndicator();
      handle.closest('.todolium-task').style.opacity = '';
      dragState = null;
    });
  });
}

// --- Render ---
function render(state) {
  const now = Date.now();

  // done_list is already sorted oldest-first (done_at ascending) by deriveState
  document.getElementById('done_list').innerHTML = state.done_list.slice(-3).map(t => `
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
        <button class="todolium-postpone" onclick="postpone('${t.task_id}', ${1 * DAY})">+1d</button>
        <button class="todolium-postpone" onclick="postpone('${t.task_id}', ${2 * DAY})">+2d</button>
        <button class="todolium-postpone" onclick="postpone('${t.task_id}', ${4 * DAY})">+4d</button>
        <button class="todolium-postpone" onclick="postpone('${t.task_id}', ${8 * DAY})">+8d</button>
        <span class="${cls}">${relDur(d)}</span>
        <span class="todolium-task-row">
          <span class="todolium-span-task">${esc(t.task)}</span>
          <span class="todolium-drag-handle" data-task-id="${t.task_id}">⠿</span>
        </span>
      </div>
    `;
  }).join('');

  setupDrag(document.getElementById('todo_list'), state.todo_list);
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

// --- Boot ---
render(deriveState(mergeChains(loadEvents(), [])));
syncWithServer();
setInterval(syncWithServer, SYNC_INTERVAL_MS);
