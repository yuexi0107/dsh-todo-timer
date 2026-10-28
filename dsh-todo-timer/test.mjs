// Unit tests for the todoTimer fold + client syntax check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const { foldTodoTimer } = await import('./lib/index.js');

const T1 = 1_730_000_000_000;
const ev = (todos, time) => ({ type: 'todo/write', time, data: { todos } });

// First write: every item gains seenAt; createdAt = earliest seenAt.
let s = foldTodoTimer(null, ev([
	{ content: 'A', status: 'in_progress' },
	{ content: 'B', status: 'pending' }
], T1));
assert.equal(s.createdAt, T1);
assert.equal(s.completedAt, null);
assert.deepEqual(s.items[0], { content: 'A', status: 'in_progress', seenAt: T1, startedAt: T1, completedAt: null });
assert.deepEqual(s.items[1], { content: 'B', status: 'pending', seenAt: T1, startedAt: null, completedAt: null });

// A completes; B starts.
const T2 = T1 + 90_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'in_progress' }
], T2));
assert.deepEqual(s.items[0], { content: 'A', status: 'completed', seenAt: T1, startedAt: T1, completedAt: T2 });
assert.equal(s.items[1].startedAt, T2);
assert.equal(s.completedAt, null);

// All done: list completedAt freezes; createdAt keeps the earliest seenAt.
const T3 = T2 + 60_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' }
], T3));
assert.equal(s.completedAt, T3);
assert.equal(s.createdAt, T1);

// Repeated all-done write keeps the frozen stamp.
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' }
], T3 + 5000));
assert.equal(s.completedAt, T3, 'frozen');

// turn/start does NOT reset (cross-turn replay keeps durations).
const before = s;
s = foldTodoTimer(s, { type: 'turn/start', time: T3 + 9000, data: {} });
assert.equal(s, before, 'turn/start is a no-op');

// Batch completion of never-observed-active items: seenAt gives a real duration, not 0s.
const B1 = T3 + 20_000;
s = foldTodoTimer(null, ev([
	{ content: 'X', status: 'pending' },
	{ content: 'Y', status: 'pending' }
], B1));
const B2 = B1 + 120_000;
s = foldTodoTimer(s, ev([
	{ content: 'X', status: 'completed' },
	{ content: 'Y', status: 'completed' }
], B2));
assert.equal(s.items[0].startedAt, null);
assert.equal(s.items[0].seenAt, B1);
assert.equal(s.items[0].completedAt, B2);
assert.equal(s.completedAt, B2);
assert.equal(s.createdAt, B1);

// Appending to a list keeps earlier items' seenAt, so createdAt stays at the true start.
const C1 = B2 + 10_000;
s = foldTodoTimer(s, ev([
	{ content: 'X', status: 'completed' },
	{ content: 'Y', status: 'completed' },
	{ content: 'Z', status: 'in_progress' }
], C1));
assert.equal(s.createdAt, B1, 'createdAt survives list growth');
assert.equal(s.completedAt, null, 'reopened list clears the frozen total');
assert.equal(s.items[2].seenAt, C1);

// Reopen: completed -> in_progress restarts the item clock but keeps seenAt.
s = foldTodoTimer(s, ev([
	{ content: 'X', status: 'completed' },
	{ content: 'Y', status: 'completed' },
	{ content: 'Z', status: 'completed' }
], C1 + 30_000));
assert.equal(s.items[2].completedAt, C1 + 30_000);
s = foldTodoTimer(s, ev([
	{ content: 'X', status: 'completed' },
	{ content: 'Y', status: 'completed' },
	{ content: 'Z', status: 'in_progress' }
], C1 + 50_000));
assert.equal(s.items[2].startedAt, C1 + 50_000, 'reopened restarts');
assert.equal(s.items[2].seenAt, C1, 'seenAt survives reopen');

// Unrelated events pass the state through unchanged.
assert.equal(foldTodoTimer(s, { type: 'user/message', time: 1, data: {} }), s);

// Rename inheritance: item text edited between writes inherits the vanished
// item's timeline at the same index, so a renamed completed item keeps its
// duration instead of freezing at 0s.
const R1 = 1_730_000_500_000;
let r = foldTodoTimer(null, ev([
	{ content: 'old name', status: 'in_progress' },
	{ content: 'other', status: 'pending' }
], R1));
const R2 = R1 + 45_000;
r = foldTodoTimer(r, ev([
	{ content: 'new name', status: 'completed' },
	{ content: 'other', status: 'in_progress' }
], R2));
assert.equal(r.items[0].content, 'new name');
assert.equal(r.items[0].seenAt, R1, 'renamed item inherits seenAt');
assert.equal(r.items[0].startedAt, R1, 'renamed item inherits startedAt');
assert.equal(r.items[0].completedAt, R2, 'rename does not fabricate completion');

// A genuinely new item at an index whose old item is still in the list does
// NOT inherit anything (no phantom timeline).
const N1 = R2 + 10_000;
r = foldTodoTimer(r, ev([
	{ content: 'new name', status: 'completed' },
	{ content: 'other', status: 'completed' },
	{ content: 'brand new', status: 'completed' }
], N1));
assert.equal(r.items[2].seenAt, N1, 'brand-new item starts now');
assert.equal(r.items[2].startedAt, null);

const client = fs.readFileSync('./lib/client.js', 'utf8');
new vm.Script(client, { filename: 'client.js' });
assert.ok(client.includes('seenAt'), 'client fallback uses seenAt');

console.log('ALL TESTS PASS');
