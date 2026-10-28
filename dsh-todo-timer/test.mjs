// Unit tests for the todoTimer fold + client syntax check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const { foldTodoTimer } = await import('./lib/index.js');

const T1 = 1_730_000_000_000;
const ev = (todos, time) => ({ type: 'todo/write', time, data: { todos } });

let s = foldTodoTimer(null, ev([
	{ content: 'A', status: 'in_progress' },
	{ content: 'B', status: 'pending' }
], T1));
assert.equal(s.createdAt, T1);
assert.equal(s.completedAt, null);
assert.deepEqual(s.items[0], { content: 'A', status: 'in_progress', startedAt: T1, completedAt: null });
assert.deepEqual(s.items[1], { content: 'B', status: 'pending', startedAt: null, completedAt: null });

const T2 = T1 + 90_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'in_progress' }
], T2));
assert.equal(s.createdAt, T1, 'same list keeps createdAt');
assert.deepEqual(s.items[0], { content: 'A', status: 'completed', startedAt: T1, completedAt: T2 });
assert.equal(s.items[1].startedAt, T2);
assert.equal(s.completedAt, null, 'not all done yet');

const T3 = T2 + 60_000;
s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' }
], T3));
assert.equal(s.completedAt, T3);
assert.equal(s.items[1].completedAt, T3);

s = foldTodoTimer(s, ev([
	{ content: 'A', status: 'completed' },
	{ content: 'B', status: 'completed' }
], T3 + 5000));
assert.equal(s.completedAt, T3, 'frozen');

const before = s;
s = foldTodoTimer(s, { type: 'turn/start', time: T3 + 9000, data: {} });
assert.equal(s, before, 'turn/start is a no-op');

const T4 = T3 + 20_000;
s = foldTodoTimer(s, ev([{ content: 'C', status: 'in_progress' }], T4));
assert.equal(s.createdAt, T4);
assert.equal(s.completedAt, null);

s = foldTodoTimer(s, ev([{ content: 'C', status: 'completed' }], T4 + 10_000));
assert.equal(s.items[0].startedAt, T4);
s = foldTodoTimer(s, ev([{ content: 'C', status: 'in_progress' }], T4 + 30_000));
assert.equal(s.items[0].startedAt, T4 + 30_000, 'reopened restarts');

assert.equal(foldTodoTimer(s, { type: 'user/message', time: 1, data: {} }), s);

const client = fs.readFileSync('./lib/client.js', 'utf8');
new vm.Script(client, { filename: 'client.js' });

console.log('ALL TESTS PASS');
