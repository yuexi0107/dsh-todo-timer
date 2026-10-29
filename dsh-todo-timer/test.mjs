// Unit tests for the todoTimer fold (0.3.0 semantics) + client syntax check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const { apply, foldTodoTimer } = await import('./lib/index.js');

const T0 = 1_800_000_000_000;
const ev = (todos, time) => ({ type: 'todo/write', time, data: { todos } });

// 1. First write: same-batch parallel runners share startedAt; a completed-first
// item never ran (startedAt null); pending has no start.
let s = foldTodoTimer(null, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'in_progress' },
	{ content: 'C', status: 'in_progress' },
	{ content: 'D', status: 'pending' }
], T0));
assert.equal(s.createdAt, T0);
assert.equal(s.firstStartedAt, T0, 'first run anchors the total');
assert.equal(s.completedAt, null);
assert.equal(s.items[0].startedAt, null, 'completed-first item never ran');
assert.equal(s.items[0].completedAt, T0);
assert.equal(s.items[1].startedAt, T0, 'parallel runner B starts with the batch');
assert.equal(s.items[2].startedAt, T0, 'parallel runner C shares the batch start');
assert.equal(s.items[3].startedAt, null);
assert.equal(s.items[3].completedAt, null);

// 2. A stays completed; B completes; C keeps running; D stays queued.
const T1 = T0 + 60_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' },
	{ content: 'C', status: 'in_progress' },
	{ content: 'D', status: 'pending' }
], T1));
assert.equal(s.items[0].completedAt, T0, 'A stays frozen');
assert.equal(s.items[1].startedAt, T0);
assert.equal(s.items[1].completedAt, T1, 'B freezes at completion');
assert.equal(s.items[2].startedAt, T0, 'C keeps its start');
assert.equal(s.items[3].startedAt, null);
assert.equal(s.firstStartedAt, T0, 'total keeps the first run start while the list continues');

// 3. All complete: C ran (T0 -> T2); D never ran (0s semantics on the client).
const T2 = T1 + 30_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' },
	{ content: 'C', status: 'completed' },
	{ content: 'D', status: 'completed' }
], T2));
assert.equal(s.items[2].startedAt, T0);
assert.equal(s.items[2].completedAt, T2);
assert.equal(s.items[3].startedAt, null, 'D went pending -> completed without running');
assert.equal(s.items[3].completedAt, T2);
assert.equal(s.completedAt, T2, 'list freezes when all complete');
assert.equal(s.firstStartedAt, T0);

// 4. Same list omits D: D is retained at its old position with its frozen timing.
const T3 = T2 + 10_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' },
	{ content: 'C', status: 'completed' }
], T3));
assert.equal(s.items.length, 4, 'completed omitted row is retained');
assert.equal(s.items[3].content, 'D');
assert.equal(s.items[3].status, 'completed');
assert.equal(s.items[3].completedAt, T2, 'retained D keeps its frozen completion');
assert.equal(s.completedAt, T2, 'total stays frozen');
assert.equal(s.firstStartedAt, T0, 'total origin survives the omission');

// 5. A brand-new list (zero overlap) drops the previous rows and resets the total.
const T4 = T3 + 20_000;
s = foldTodoTimer(s, ev([{ content: 'E', status: 'in_progress' }], T4));
assert.equal(s.items.length, 1, 'new list drops old rows');
assert.equal(s.items[0].content, 'E');
assert.equal(s.items[0].startedAt, T4);
assert.equal(s.firstStartedAt, T4, 'new list starts its own total');
assert.equal(s.completedAt, null);
assert.equal(s.createdAt, T4);

// 6. turn/start keeps items and the total origin; it only re-arms the turn clocks.
const before = s;
s = foldTodoTimer(s, { type: 'turn/start', time: T4 + 5_000, data: {} });
assert.deepEqual(s.items, before.items, 'turn/start preserves item timelines');
assert.equal(s.firstStartedAt, T4);
assert.equal(s.completedAt, before.completedAt);
assert.equal(s.turnStartedAt, T4 + 5_000, 'turn clock armed');
assert.equal(s.lastWriteInTurn, null, 'write clock re-armed');

// 7. An empty list clears the current list.
const T5 = T4 + 10_000;
s = foldTodoTimer(s, ev([], T5));
assert.deepEqual(s.items, []);
assert.equal(s.createdAt, T5);
assert.equal(s.firstStartedAt, null);
assert.equal(s.completedAt, null);

// 8. Rename inheritance: a completed item's text edited at the same index keeps
// its timeline instead of appearing as a fresh 0s task.
const R0 = T5 + 1_000;
let r = foldTodoTimer(null, ev([
	{ content: 'old name', status: 'in_progress' },
	{ content: 'other', status: 'pending' }
], R0));
const R1 = R0 + 45_000;
r = foldTodoTimer(r, ev([
	{ content: 'old name', status: 'completed' },
	{ content: 'other', status: 'in_progress' }
], R1));
const R2 = R1 + 15_000;
r = foldTodoTimer(r, ev([
	{ content: 'new name', status: 'completed' },
	{ content: 'other', status: 'completed' }
], R2));
assert.equal(r.items.length, 2, 'rename does not duplicate the row');
assert.equal(r.items[0].content, 'new name');
assert.equal(r.items[0].startedAt, R0, 'renamed completed item inherits start');
assert.equal(r.items[0].completedAt, R1, 'renamed completed item inherits completion');
assert.equal(r.items[1].content, 'other');
assert.equal(r.items[1].completedAt, R2);

// 9. Only completed rows are retained; vanished pending/running rows are dropped.
const P0 = R2 + 1_000;
let p = foldTodoTimer(null, ev([
	{ content: 'done', status: 'completed' },
	{ content: 'queue', status: 'pending' },
	{ content: 'run', status: 'in_progress' }
], P0));
const P1 = P0 + 5_000;
p = foldTodoTimer(p, ev([{ content: 'done', status: 'completed' }], P1));
assert.equal(p.items.length, 1, 'only completed rows are retained');
assert.equal(p.items[0].content, 'done');

// 10. A completed-only list that never ran has no total origin but freezes its list completion.
const N0 = P1 + 1_000;
const n = foldTodoTimer(null, ev([{ content: 'finished', status: 'completed' }], N0));
assert.equal(n.items[0].startedAt, null);
assert.equal(n.items[0].completedAt, N0);
assert.equal(n.firstStartedAt, null);
assert.equal(n.completedAt, N0);

// 10b. A brand-new all-completed list resets the list completion stamp.
const Q0 = N0 + 1_000;
let q = foldTodoTimer(null, ev([{ content: 'old done', status: 'in_progress' }], Q0));
q = foldTodoTimer(q, ev([{ content: 'old done', status: 'completed' }], Q0 + 1_000));
assert.equal(q.completedAt, Q0 + 1_000);
q = foldTodoTimer(q, ev([{ content: 'new done', status: 'completed' }], Q0 + 2_000));
assert.equal(q.completedAt, Q0 + 2_000, 'brand-new all-completed list resets completedAt');
assert.equal(q.firstStartedAt, null, 'new all-completed list has no run start');

// 10c. A newly completed item appended to an already-complete list moves the stamp.
const V0 = Q0 + 3_000;
let v = foldTodoTimer(null, ev([{ content: 'A', status: 'completed' }], V0));
assert.equal(v.completedAt, V0);
v = foldTodoTimer(v, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' }
], V0 + 1_000));
assert.equal(v.completedAt, V0 + 1_000, 'new completed item moves the list stamp');

// 11. Registration: the unit is todoTimer, version 8, and folds with this function.
const registrations = [];
apply({ sessionProjections: { register: (definition) => registrations.push(definition) } });
assert.equal(registrations.length, 1);
assert.equal(registrations[0].key, 'todoTimer');
assert.equal(registrations[0].stateVersion, 8);
assert.equal(registrations[0].apply, foldTodoTimer);

// 12. Unrelated events pass the state through unchanged.
assert.equal(foldTodoTimer(n, { type: 'user/message', time: 1, data: {} }), n);

// --- client half: parse as a classic script (it is a loader call, not ESM) ---
const client = fs.readFileSync('./lib/client.js', 'utf8');
new vm.Script(client, { filename: 'client.js' });
assert.ok(client.includes('data-testid'), 'client keeps test hooks');
assert.ok(client.includes('index + 1'), 'client renders row ordinals');
assert.ok(client.includes('return "0s"'), 'client renders 0s for never-ran completed rows');

console.log('ALL TESTS PASS');
