import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChains, deriveState, calculateInsertionDeadline } from './engine.js';
const DAY = 24 * 60 * 60 * 1000;
function ev(partial) {
    return { device_id: 'test-device', ...partial };
}
// T1: add → postpone → mark_done
test('T1: basic add, postpone, mark_done', () => {
    const events = mergeChains([
        ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Buy milk' }),
        ev({ eid: 'E2', type: 'postpone', task_id: 'T1', at: 200, parent_eid: 'E1', ms: DAY }),
        ev({ eid: 'E3', type: 'mark_done', task_id: 'T1', at: 300, parent_eid: 'E2' }),
    ], []);
    const state = deriveState(events);
    assert.equal(state.todo_list.length, 0);
    assert.equal(state.done_list.length, 1);
    assert.equal(state.done_list[0].done_at, 300);
    assert.equal(state.done_list[0].created_at, 100);
});
// T2: 2 devices add different tasks offline — both appear after merge
test('T2: two devices add different tasks offline', () => {
    const a = [ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Task A' })];
    const b = [ev({ eid: 'E2', type: 'add_todo', task_id: 'T2', at: 150, parent_eid: null, task: 'Task B' })];
    const state = deriveState(mergeChains(a, b));
    assert.equal(state.todo_list.length, 2);
    assert.deepEqual(state.todo_list.map(t => t.task).sort(), ['Task A', 'Task B']);
});
// T3: 2 devices postpone the same task concurrently — newer timestamp wins
test('T3: concurrent postpone, newer timestamp wins', () => {
    const base = [ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Task' })];
    const a = [...base, ev({ eid: 'E2', type: 'postpone', task_id: 'T1', at: 200, parent_eid: 'E1', ms: DAY })];
    const b = [...base, ev({ eid: 'E3', type: 'postpone', task_id: 'T1', at: 250, parent_eid: 'E1', ms: 2 * DAY })];
    const state = deriveState(mergeChains(a, b));
    assert.equal(state.todo_list.length, 1);
    assert.equal(state.todo_list[0].deadline, 250 + 2 * DAY);
});
// T4: A marks done (at=250), B postpones (at=200) — mark_done chain wins, postpone discarded
test('T4: mark_done(250) beats postpone(200) in fork', () => {
    const base = [ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Task' })];
    const a = [...base, ev({ eid: 'E3', type: 'mark_done', task_id: 'T1', at: 250, parent_eid: 'E1' })];
    const b = [...base, ev({ eid: 'E2', type: 'postpone', task_id: 'T1', at: 200, parent_eid: 'E1', ms: DAY })];
    const state = deriveState(mergeChains(a, b));
    assert.equal(state.done_list.length, 1);
    assert.equal(state.done_list[0].done_at, 250);
    assert.equal(state.todo_list.length, 0);
});
// T5: syncing the same events twice is idempotent
test('T5: idempotent sync', () => {
    const events = [
        ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Task' }),
        ev({ eid: 'E2', type: 'postpone', task_id: 'T1', at: 200, parent_eid: 'E1', ms: DAY }),
    ];
    const once = deriveState(mergeChains(events, events));
    const twice = deriveState(mergeChains(mergeChains(events, events), events));
    assert.deepEqual(once, twice);
});
// T6: revert restores the deadline that was in effect before mark_done
test('T6: revert restores pre-done deadline', () => {
    const events = mergeChains([
        ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Task' }),
        ev({ eid: 'E2', type: 'postpone', task_id: 'T1', at: 200, parent_eid: 'E1', ms: DAY }),
        ev({ eid: 'E3', type: 'mark_done', task_id: 'T1', at: 300, parent_eid: 'E2' }),
        ev({ eid: 'E4', type: 'revert', task_id: 'T1', at: 400, parent_eid: 'E3' }),
    ], []);
    const state = deriveState(events);
    assert.equal(state.todo_list.length, 1);
    assert.equal(state.todo_list[0].deadline, 200 + DAY);
    assert.equal(state.done_list.length, 0);
});
// T7: two devices revert the same mark_done — newer revert wins
test('T7: concurrent reverts, newer wins', () => {
    const base = [
        ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Task' }),
        ev({ eid: 'E2', type: 'mark_done', task_id: 'T1', at: 200, parent_eid: 'E1' }),
    ];
    const a = [...base, ev({ eid: 'E3', type: 'revert', task_id: 'T1', at: 300, parent_eid: 'E2' })];
    const b = [...base, ev({ eid: 'E4', type: 'revert', task_id: 'T1', at: 350, parent_eid: 'E2' })];
    const state = deriveState(mergeChains(a, b));
    assert.equal(state.todo_list.length, 1);
    assert.equal(state.done_list.length, 0);
});
// T8: edit_task(at=200) vs mark_done(at=250) — mark_done wins, edit discarded
test('T8: edit_task(200) loses to mark_done(250)', () => {
    const base = [ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Old name' })];
    const a = [...base, ev({ eid: 'E2', type: 'edit_task', task_id: 'T1', at: 200, parent_eid: 'E1', task: 'New name' })];
    const b = [...base, ev({ eid: 'E3', type: 'mark_done', task_id: 'T1', at: 250, parent_eid: 'E1' })];
    const state = deriveState(mergeChains(a, b));
    assert.equal(state.done_list.length, 1);
    assert.equal(state.done_list[0].task, 'Old name');
    assert.equal(state.todo_list.length, 0);
});
// T9: edit_task(at=300) vs mark_done(at=250) — edit wins, task stays active with new name
test('T9: edit_task(300) beats mark_done(250)', () => {
    const base = [ev({ eid: 'E1', type: 'add_todo', task_id: 'T1', at: 100, parent_eid: null, task: 'Old name' })];
    const a = [...base, ev({ eid: 'E2', type: 'edit_task', task_id: 'T1', at: 300, parent_eid: 'E1', task: 'New name' })];
    const b = [...base, ev({ eid: 'E3', type: 'mark_done', task_id: 'T1', at: 250, parent_eid: 'E1' })];
    const state = deriveState(mergeChains(a, b));
    assert.equal(state.todo_list.length, 1);
    assert.equal(state.todo_list[0].task, 'New name');
    assert.equal(state.done_list.length, 0);
});
function task(deadline) {
    return { task_id: 'x', task: 'x', created_at: 0, deadline };
}
const DAY_MS = 24 * 60 * 60 * 1000;
// T10: inserting between two tasks returns the midpoint deadline
test('T10: calculateInsertionDeadline between two tasks returns midpoint', () => {
    const above = task(DAY_MS);
    const below = task(3 * DAY_MS);
    assert.equal(calculateInsertionDeadline(above, below), 2 * DAY_MS);
});
// T11: inserting into top position returns first.deadline - 1 day
test('T11: calculateInsertionDeadline at top returns first.deadline - 1 day', () => {
    const below = task(5000);
    assert.equal(calculateInsertionDeadline(null, below), 5000 - DAY_MS);
});
// T11b: top insert works even when first task is already overdue (deadline in past)
test('T11b: calculateInsertionDeadline at top works with overdue first task', () => {
    const pastDeadline = Date.now() - 2 * DAY_MS;
    const below = task(pastDeadline);
    assert.equal(calculateInsertionDeadline(null, below), pastDeadline - DAY_MS);
});
// T12: inserting into bottom position returns last.deadline + 1 day
test('T12: calculateInsertionDeadline at bottom returns last.deadline + 1 day', () => {
    const above = task(5000);
    assert.equal(calculateInsertionDeadline(above, null), 5000 + DAY_MS);
});
// T13: when neighbors share the same deadline, minimum gap is enforced
test('T13: calculateInsertionDeadline enforces minimum gap for identical deadlines', () => {
    const d = 10000;
    const result = calculateInsertionDeadline(task(d), task(d));
    assert.ok(result > d, 'result should be greater than above.deadline');
    assert.ok(result < d + 60_000, 'result should be within min gap');
});
// T14: empty list (both null) returns approximately now + 1 day
test('T14: calculateInsertionDeadline with no neighbors returns now + 1 day', () => {
    const before = Date.now();
    const result = calculateInsertionDeadline(null, null);
    const after = Date.now();
    assert.ok(result >= before + DAY_MS);
    assert.ok(result <= after + DAY_MS);
});
//# sourceMappingURL=engine.test.js.map