import type { TodoEvent, Task, TodoState } from './types.js';

const MIN_GAP_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

// Deterministic winner between two events: higher at wins, eid breaks ties.
function winner(a: TodoEvent, b: TodoEvent): TodoEvent {
  return a.at > b.at || (a.at === b.at && a.eid > b.eid) ? a : b;
}

// Given all events for a single task, walk the winning chain from root to tip.
// At each fork (multiple children of the same parent), the newest event wins
// and the entire losing branch (all descendants) is discarded.
function resolveTaskChain(events: TodoEvent[]): TodoEvent[] {
  if (events.length === 0) return [];

  const childrenOf = new Map<string | null, TodoEvent[]>();
  for (const e of events) {
    const list = childrenOf.get(e.parent_eid) ?? [];
    list.push(e);
    childrenOf.set(e.parent_eid, list);
  }

  const roots = childrenOf.get(null) ?? [];
  if (roots.length === 0) return [];

  const result: TodoEvent[] = [];
  let current = roots.reduce(winner);
  result.push(current);

  while (true) {
    const children = childrenOf.get(current.eid) ?? [];
    if (children.length === 0) break;
    current = children.reduce(winner);
    result.push(current);
  }

  return result;
}

// Union local and remote events (deduplicate by eid), then resolve forks
// per task. Returns the set of events that form the winning chains.
export function mergeChains(local: TodoEvent[], remote: TodoEvent[]): TodoEvent[] {
  const all = new Map<string, TodoEvent>();
  for (const e of [...local, ...remote]) all.set(e.eid, e);

  const byTask = new Map<string, TodoEvent[]>();
  for (const e of all.values()) {
    const list = byTask.get(e.task_id) ?? [];
    list.push(e);
    byTask.set(e.task_id, list);
  }

  const result: TodoEvent[] = [];
  for (const taskEvents of byTask.values()) {
    result.push(...resolveTaskChain(taskEvents));
  }
  return result;
}

// Replay a fork-resolved event list to produce the current display state.
// Events must already be the output of mergeChains (no unresolved forks).
export function deriveState(events: TodoEvent[]): TodoState {
  const sorted = [...events].sort((a, b) => a.at - b.at || a.eid.localeCompare(b.eid));
  const tasks = new Map<string, Task>();

  for (const e of sorted) {
    switch (e.type) {
      case 'add_todo': {
        tasks.set(e.task_id, {
          task_id:    e.task_id,
          task:       e.task!,
          created_at: e.at,
          deadline:   e.at + DAY_MS,
        });
        break;
      }
      case 'edit_task': {
        const t = tasks.get(e.task_id);
        if (t) t.task = e.task!;
        break;
      }
      case 'postpone': {
        const t = tasks.get(e.task_id);
        if (t) t.deadline = e.at + e.ms!;
        break;
      }
      case 'mark_done': {
        const t = tasks.get(e.task_id);
        if (t) t.done_at = e.at;
        break;
      }
      case 'revert': {
        const t = tasks.get(e.task_id);
        // mark_done does not modify deadline, so the current deadline
        // is already the pre-done value — just clear done_at.
        if (t) delete t.done_at;
        break;
      }
    }
  }

  const todo_list = [...tasks.values()]
    .filter(t => t.done_at === undefined)
    .sort((a, b) => a.deadline - b.deadline);

  const done_list = [...tasks.values()]
    .filter((t): t is Task & { done_at: number } => t.done_at !== undefined)
    .sort((a, b) => a.done_at - b.done_at);

  return { todo_list, done_list };
}

// Returns the deadline to assign to a task inserted between above and below.
// above=null means insertion before the first task; below=null means after the last.
export function calculateInsertionDeadline(above: Task | null, below: Task | null): number {
  if (above === null && below === null) return Date.now() + DAY_MS;
  if (above === null) return below!.deadline - DAY_MS;
  if (below === null) return above.deadline + DAY_MS;
  const mid = Math.floor((above.deadline + below.deadline) / 2);
  if (below.deadline - above.deadline < MIN_GAP_MS) {
    return above.deadline + Math.floor(MIN_GAP_MS / 2);
  }
  return mid;
}
