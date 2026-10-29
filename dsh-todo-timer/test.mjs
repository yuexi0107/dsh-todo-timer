// Unit tests for the todoTimer fold (0.3.1 conversation-wide persistence) + client syntax check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const { apply, foldTodoTimer } = await import('./lib/index.js');

const T0 = 1_800_000_000_000;
const ev = (todos, time) => ({ type: 'todo/write', time, data: { todos } });

// 1. First write: A completed-first (never ran), B/C parallel runners, D queued.
let s = foldTodoTimer(null, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'in_progress' },
	{ content: 'C', status: 'in_progress' },
	{ content: 'D', status: 'pending' }
], T0));
assert.equal(s.items.length, 4);
assert.equal(s.items[0].startedAt, null, 'A never ran');
assert.equal(s.items[0].completedAt, T0);
assert.equal(s.items[0].order, 0);
assert.equal(s.items[0].archived, false);
assert.equal(s.items[1].startedAt, T0, 'B starts with the batch');
assert.equal(s.items[2].startedAt, T0, 'C shares the batch start');
assert.equal(s.items[3].startedAt, null);
assert.equal(s.firstStartedAt, T0);
assert.equal(s.completedAt, null);
assert.equal(s.nextOrder, 4);

// 2. T1: A/B completed, C running, D queued.
const T1 = T0 + 60_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' },
	{ content: 'C', status: 'in_progress' },
	{ content: 'D', status: 'pending' }
], T1));
assert.equal(s.items[1].startedAt, T0);
assert.equal(s.items[1].completedAt, T1, 'B freezes');
assert.equal(s.items[2].startedAt, T0, 'C keeps running');
assert.equal(s.firstStartedAt, T0, 'conversation total keeps the first run start');

// 3. T2: all complete; C ran T0->T2; D never ran.
const T2 = T1 + 30_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' },
	{ content: 'C', status: 'completed' },
	{ content: 'D', status: 'completed' }
], T2));
assert.equal(s.items[2].startedAt, T0);
assert.equal(s.items[2].completedAt, T2);
assert.equal(s.items[3].startedAt, null, 'D pending -> completed never ran');
assert.equal(s.items[3].completedAt, T2);
assert.equal(s.completedAt, T2);
assert.equal(s.firstStartedAt, T0);

// 4. T3: same list omits D -> D is archived and kept.
const T3 = T2 + 10_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' },
	{ content: 'C', status: 'completed' }
], T3));
assert.equal(s.items.length, 4);
assert.equal(s.items[3].content, 'D');
assert.equal(s.items[3].archived, true, 'omitted completed row archived');
assert.equal(s.items[3].completedAt, T2);
assert.equal(s.completedAt, T2);

// 5. T4: brand-new list [E in_progress] -> all previous completed rows stay as
// archived history; the conversation total does NOT reset.
const T4 = T3 + 20_000;
s = foldTodoTimer(s, ev([{ content: 'E', status: 'in_progress' }], T4));
assert.equal(s.items.length, 5, 'A/B/C/D history + E');
assert.equal(s.items[4].content, 'E');
assert.equal(s.items[4].archived, false);
assert.equal(s.items[4].startedAt, T4);
assert.equal(s.items[0].archived, true);
assert.equal(s.items[3].archived, true);
assert.equal(s.firstStartedAt, T0, 'total does NOT reset on a new list');
assert.equal(s.completedAt, null, 'new running task resumes the total');
assert.equal(s.nextOrder, 5);

// 6. T5: empty list -> open E is dropped; completed history remains; total freezes.
const T5 = T4 + 10_000;
s = foldTodoTimer(s, ev([], T5));
assert.equal(s.items.length, 4, 'completed history remains after clearing the list');
assert.ok(s.items.every((item) => item.status === 'completed' && item.archived === true));
assert.equal(s.firstStartedAt, T0);
assert.equal(s.completedAt, T2, 'total freezes at the latest completion');

// 7. T6: a new completed-only list appends F; total moves to the new completion.
const T6 = T5 + 10_000;
s = foldTodoTimer(s, ev([{ content: 'F', status: 'completed' }], T6));
assert.equal(s.items.length, 5);
assert.equal(s.items[4].content, 'F');
assert.equal(s.items[4].startedAt, null);
assert.equal(s.items[4].completedAt, T6);
assert.equal(s.completedAt, T6, 'total moves forward for a new completion');
assert.equal(s.firstStartedAt, T0);

// 8. T7: reopen archived A under a new list -> A becomes current again, clock restarts.
const T7 = T6 + 10_000;
s = foldTodoTimer(s, ev([{ content: 'A', status: 'in_progress' }], T7));
assert.equal(s.items.length, 5);
const reopened = s.items.find((item) => item.content === 'A');
assert.ok(reopened, 'A row remains');
assert.equal(reopened.archived, false);
assert.equal(reopened.startedAt, T7, 'reopened clock restarts');
assert.equal(reopened.completedAt, null);
assert.equal(s.completedAt, null, 'total resumes');
assert.equal(s.firstStartedAt, T0, 'total origin still the conversation first run');
assert.ok(s.items.find((item) => item.content === 'F').archived === true, 'omitted F archived');

// 9. turn/start keeps items and the conversation total origin.
const before = s;
s = foldTodoTimer(s, { type: 'turn/start', time: T7 + 5_000, data: {} });
assert.deepEqual(s.items, before.items);
assert.equal(s.firstStartedAt, T0);
assert.equal(s.turnStartedAt, T7 + 5_000);
assert.equal(s.lastWriteInTurn, null);

// 10. Empty list on a fresh conversation: no history, no panel.
const empty = foldTodoTimer(null, ev([], T0));
assert.deepEqual(empty.items, []);
assert.equal(empty.firstStartedAt, null);
assert.equal(empty.completedAt, null);
assert.equal(empty.createdAt, T0);

// 11. Rename inheritance for a completed current item (text edit keeps its timeline).
const R0 = T0 + 1_000;
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
assert.equal(r.items.length, 2, 'rename does not duplicate');
assert.equal(r.items[0].content, 'new name');
assert.equal(r.items[0].startedAt, R0);
assert.equal(r.items[0].completedAt, R1);
assert.equal(r.items[1].completedAt, R2);
assert.equal(r.completedAt, R2);

// 12. Only completed current rows are retained; open omitted rows are dropped.
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
assert.equal(p.items[0].archived, false);

// 13. Registration: todoTimer, stateVersion 9, folds with this function.
const registrations = [];
apply({ sessionProjections: { register: (definition) => registrations.push(definition) } });
assert.equal(registrations.length, 1);
assert.equal(registrations[0].key, 'todoTimer');
assert.equal(registrations[0].stateVersion, 9);
assert.equal(registrations[0].apply, foldTodoTimer);

// 14. Unrelated events pass the state through unchanged.
assert.equal(foldTodoTimer(p, { type: 'user/message', time: 1, data: {} }), p);

// --- client half: parse as a classic script (it is a loader call, not ESM) ---
const client = fs.readFileSync('./lib/client.js', 'utf8');
new vm.Script(client, { filename: 'client.js' });
assert.ok(client.includes('data-testid'), 'client keeps test hooks');
assert.ok(client.includes('index + 1'), 'client renders row ordinals');
assert.ok(client.includes('return "0s"'), 'client renders 0s for never-ran completed rows');

console.log('ALL TESTS PASS');
