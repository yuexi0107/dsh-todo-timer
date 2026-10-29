// Component-level tests for the client half. The real `lib/client.js` bundle is
// executed in a vm sandbox with a minimal React runtime, so the assertions run
// against the exact code the browser loads. Covers the behavior contract:
//   * only `in_progress` items tick, several in parallel tick together;
//   * `pending` items show no clock at all;
//   * `completed` items freeze at startedAt -> completedAt (never-ran = no clock);
//   * the header shows a live total that starts with the first task run and
//     freezes when the whole list is done;
//   * the header total keeps ticking while the panel is collapsed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const { foldTodoTimer } = await import(new URL('./lib/index.js', import.meta.url).href);

//#region minimal React runtime -------------------------------------------------
function sameDeps(a, b) {
	if (!a || !b || a.length !== b.length) return false;
	return a.every((value, index) => Object.is(value, b[index]));
}

/** One mounted component instance: persistent hooks, effects with deps, rerender. */
function createRuntime() {
	const hookStates = [];
	const memoStates = [];
	const effectStates = [];
	let cursor = 0;
	let pendingEffects = [];
	const runtime = {
		useState(init) {
			const index = cursor++;
			if (!(index in hookStates)) hookStates[index] = typeof init === 'function' ? init() : init;
			const set = (value) => { hookStates[index] = typeof value === 'function' ? value(hookStates[index]) : value; };
			return [hookStates[index], set];
		},
		useMemo(fn, deps) {
			const index = cursor++;
			const prev = memoStates[index];
			if (prev && sameDeps(prev.deps, deps)) return prev.value;
			const value = fn();
			memoStates[index] = { value, deps };
			return value;
		},
		useEffect(fn, deps) { pendingEffects.push({ index: cursor++, fn, deps }); },
		useLayoutEffect(fn, deps) { pendingEffects.push({ index: cursor++, fn, deps }); }
	};
	return {
		runtime,
		/** Run one render pass and commit the effects whose deps changed. */
		render(Component, props) {
			cursor = 0;
			pendingEffects = [];
			const tree = Component(props);
			const effects = pendingEffects;
			pendingEffects = [];
			for (const effect of effects) {
				const prev = effectStates[effect.index];
				if (prev && sameDeps(prev.deps, effect.deps)) continue;
				if (prev && typeof prev.cleanup === 'function') prev.cleanup();
				const cleanup = effect.fn();
				effectStates[effect.index] = { deps: effect.deps, cleanup };
			}
			return tree;
		},
		/** Tear the component down like a real unmount. */
		unmount() {
			for (const state of effectStates) if (state && typeof state.cleanup === 'function') state.cleanup();
			effectStates.length = 0;
		}
	};
}
//#endregion

//#region JSX tree helpers ------------------------------------------------------
const jsxRuntime = {
	jsx: (type, props) => ({ type, props: props ?? {} }),
	jsxs: (type, props) => ({ type, props: props ?? {} })
};

/** Concatenate every text node under a JSX tree, materializing function components. */
function textOf(node) {
	if (node === null || node === void 0 || node === false || node === true) return '';
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(textOf).join('');
	if (typeof node.type === 'function') return textOf(node.type(node.props));
	return textOf(node.props.children);
}

/** Depth-first search over materialized JSX nodes. */
function findAll(node, predicate, out = []) {
	if (node === null || node === void 0 || typeof node !== 'object') return out;
	if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out; }
	if (typeof node.type === 'function') return findAll(node.type(node.props), predicate, out);
	if (predicate(node)) out.push(node);
	const children = node.props?.children;
	if (children !== undefined) findAll(children, predicate, out);
	return out;
}

function byTestId(tree, id) {
	return findAll(tree, (node) => node.props?.['data-testid'] === id)[0] ?? null;
}

function itemsOf(tree) {
	return findAll(tree, (node) => node.type === 'li').map((li) => {
		const timeNode = byTestId(li, 'todo-timer-item-time');
		const time = timeNode === null ? null : textOf(timeNode);
		const full = textOf(li);
		const withoutTime = time === null ? full : full.slice(0, full.length - time.length);
		// Rows now start with an ordinal ("1.", "2.", ...): expose it separately
		// and strip it from the task content used by the behavior assertions.
		const ordinal = /^(\d+)\./.exec(withoutTime)?.[1] ?? null;
		const content = withoutTime.replace(/^\d+\.\s*/, '');
		return { status: li.props['data-status'], content, time, ordinal, full };
	});
}

function totalOf(tree) {
	const node = byTestId(tree, 'todo-timer-total');
	return node === null ? null : textOf(node);
}
//#endregion

//#region bundle loader ---------------------------------------------------------
const clientSource = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8');
const intervals = [];
let intervalSeq = 0;
let currentNow = 0;
let captured = null;

const sandbox = {
	document: { documentElement: { lang: 'zh-CN' } },
	Date: { now: () => currentNow },
	setInterval: (fn, ms) => { const id = ++intervalSeq; intervals.push({ id, fn, ms, cleared: false }); return id; },
	clearInterval: (id) => { const found = intervals.find((entry) => entry.id === id); if (found) found.cleared = true; },
	console
};
sandbox.window = { __ModuleLoader__: { load: (definition) => { captured = definition; } } };
vm.createContext(sandbox);
vm.runInContext(clientSource, sandbox, { filename: 'client.js' });
assert.ok(captured !== null, 'client bundle registers a module factory');
assert.equal(captured.id, 'dsh-todo-timer');

/** A no-op React surface for the module-level load (only formatDuration is used). */
const dummyReact = { useState: (init) => [typeof init === 'function' ? init() : init, () => {}], useEffect: () => {}, useMemo: (fn) => fn() };
const client = captured.factory((request) => {
	if (request === 'react') return dummyReact;
	if (request === 'react/jsx-runtime') return jsxRuntime;
	throw new Error(`unexpected require: ${request}`);
});

/** Mount a fresh TodoTimerPanel instance at `now`. */
function mount(todos, timer, now) {
	currentNow = now;
	const runtime = createRuntime();
	const Panel = captured.factory((request) => {
		if (request === 'react') return runtime.runtime;
		if (request === 'react/jsx-runtime') return jsxRuntime;
		throw new Error(`unexpected require: ${request}`);
	}).TodoTimerPanel;
	let tree = runtime.render(Panel, { todos, timer });
	const panel = {
		get tree() { return tree; },
		get text() { return textOf(tree); },
		get items() { return itemsOf(tree); },
		get total() { return totalOf(tree); },
		/** Advance the wall clock and run the live interval callback once. */
		tick(deltaMs) {
			currentNow += deltaMs;
			for (const entry of intervals) if (!entry.cleared) entry.fn();
			tree = runtime.render(Panel, { todos, timer });
		},
		/** Re-render after props changed (e.g. the list completed). */
		update(nextTodos, nextTimer, atNow) {
			todos = nextTodos;
			timer = nextTimer;
			if (atNow !== undefined) currentNow = atNow;
			tree = runtime.render(Panel, { todos, timer });
		},
		/** Click the header button (toggles collapsed). */
		toggle() {
			const button = findAll(tree, (node) => node.type === 'button')[0];
			button.props.onClick();
			tree = runtime.render(Panel, { todos, timer });
		},
		liveIntervals() { return intervals.filter((entry) => !entry.cleared); },
		unmount: () => runtime.unmount()
	};
	return panel;
}

const T = 1_800_000_000_000;
/** Fixture item: a task that is open or done is assumed to have started at T unless told otherwise. */
const item = (content, status, stamps = {}) => ({
	content,
	status,
	seenAt: stamps.seenAt ?? T,
	startedAt: stamps.startedAt !== undefined ? stamps.startedAt : status === 'pending' ? null : T,
	completedAt: stamps.completedAt !== undefined ? stamps.completedAt : null
});
const timerOf = (items, extra = {}) => ({ items, createdAt: T, completedAt: null, ...extra });

//#region formatDuration --------------------------------------------------------
assert.equal(client.formatDuration(0), '0s');
assert.equal(client.formatDuration(45_000), '45s');
assert.equal(client.formatDuration(125_000), '2m 05s');
assert.equal(client.formatDuration(3_785_000), '1h 03m 05s');
assert.equal(client.formatDuration(-5), '0s');
console.log('ok  formatDuration');

//#region pending items have no clock ------------------------------------------
{
	intervals.length = 0;
	const panel = mount(
		[{ content: 'A', status: 'pending' }],
		timerOf([item('A', 'pending')]),
		T + 45_000
	);
	panel.toggle();
	assert.equal(panel.items[0].time, null, 'pending item shows no clock');
	assert.equal(panel.total, null, 'an all-pending list has no total');
	assert.equal(panel.liveIntervals().length, 0, 'nothing ticks for an all-pending list');
	panel.unmount();
}
console.log('ok  pending has no clock');

//#region running items tick together, pending stays silent --------------------
{
	intervals.length = 0;
	const todos = [
		{ content: 'P1', status: 'in_progress' },
		{ content: 'P2', status: 'in_progress' },
		{ content: 'Q1', status: 'pending' }
	];
	const timer = timerOf([item('P1', 'in_progress'), item('P2', 'in_progress'), item('Q1', 'pending')]);
	const panel = mount(todos, timer, T + 45_000);
	panel.toggle();
	assert.deepEqual(panel.items.map((entry) => [entry.content, entry.time]), [
		['P1', '45s'],
		['P2', '45s'],
		['Q1', null]
	]);
	assert.equal(panel.total, '总耗时 45s');
	assert.equal(panel.liveIntervals().length, 1, 'one shared ticker drives all clocks');
	panel.tick(1000);
	assert.deepEqual(panel.items.map((entry) => entry.time), ['46s', '46s', null], 'parallel items advance together');
	panel.tick(60_000);
	assert.deepEqual(panel.items.map((entry) => entry.time), ['1m 46s', '1m 46s', null]);
	assert.equal(panel.total, '总耗时 1m 46s');
	panel.unmount();
	assert.equal(panel.liveIntervals().length, 0, 'ticker cleared on unmount');
}
console.log('ok  parallel running items tick together, queued stays silent');

//#region collapsed panel still shows (and ticks) the total --------------------
{
	intervals.length = 0;
	const todos = [{ content: 'P1', status: 'in_progress' }];
	const timer = timerOf([item('P1', 'in_progress')]);
	const panel = mount(todos, timer, T + 10_000);
	assert.equal(panel.items.length, 0, 'default collapsed hides the item list');
	assert.equal(panel.total, '总耗时 10s', 'the header total is visible while collapsed');
	assert.equal(panel.liveIntervals().length, 1, 'the total keeps ticking while collapsed');
	panel.tick(5000);
	assert.equal(panel.total, '总耗时 15s');
	panel.unmount();
}
console.log('ok  collapsed header total ticks');

//#region completed items freeze at their run time -----------------------------
{
	intervals.length = 0;
	const todos = [
		{ content: 'A', status: 'completed' },
		{ content: 'B', status: 'in_progress' }
	];
	const timer = timerOf([
		item('A', 'completed', { startedAt: T, completedAt: T + 125_000 }),
		item('B', 'in_progress', { startedAt: T + 125_000 })
	], { firstStartedAt: T });
	const panel = mount(todos, timer, T + 130_000);
	panel.toggle();
	assert.equal(panel.items[0].time, '2m 05s', 'completed item freezes at startedAt -> completedAt');
	assert.equal(panel.items[1].time, '5s');
	assert.equal(panel.total, '总耗时 2m 10s');
	panel.update([
		{ content: 'A', status: 'completed' },
		{ content: 'B', status: 'completed' }
	], timerOf([
		item('A', 'completed', { startedAt: T, completedAt: T + 125_000 }),
		item('B', 'completed', { startedAt: T + 125_000, completedAt: T + 140_000 })
	], { firstStartedAt: T, completedAt: T + 140_000 }), T + 999_000);
	assert.equal(panel.total, '总耗时 2m 20s', 'all-done total freezes at the last completion');
	assert.equal(panel.liveIntervals().length, 0, 'ticker stops once the list is done');
	panel.unmount();
}
console.log('ok  completed freezes + total freezes');

//#region never-ran completed items show 0s -------------------------------------
{
	intervals.length = 0;
	const todos = [
		{ content: 'A', status: 'completed' },
		{ content: 'Q1', status: 'completed' }
	];
	const timer = timerOf([
		item('A', 'completed', { startedAt: T, completedAt: T + 60_000 }),
		item('Q1', 'completed', { startedAt: null, completedAt: T + 90_000 })
	], { firstStartedAt: T });
	const panel = mount(todos, timer, T + 90_000);
	panel.toggle();
	assert.equal(panel.items[0].time, '1m 00s');
	assert.equal(panel.items[1].time, '0s', 'queued -> completed without ever running shows 0s');
	assert.equal(panel.total, '总耗时 1m 30s', 'total still ends at the last completion');
	panel.unmount();
}
console.log('ok  never-ran completed item shows 0s');

//#region old host fallback (no firstStartedAt) --------------------------------
{
	intervals.length = 0;
	const todos = [{ content: 'A', status: 'in_progress' }];
	const timer = timerOf([item('A', 'in_progress', { startedAt: T + 5000 })]);
	const panel = mount(todos, timer, T + 35_000);
	assert.equal(panel.total, '总耗时 30s', 'older host halves fall back to the earliest startedAt');
	panel.unmount();
}
console.log('ok  old-host fallback');

//#region missing projection ---------------------------------------------------
{
	intervals.length = 0;
	const panel = mount([{ content: 'A', status: 'in_progress' }], null, T);
	panel.toggle();
	assert.equal(panel.items[0].time, null);
	assert.equal(panel.total, null);
	assert.equal(panel.liveIntervals().length, 0);
	panel.unmount();
}
console.log('ok  missing projection degrades gracefully');

//#region empty list renders nothing ------------------------------------------
{
	const panel = mount([], null, T);
	assert.equal(panel.tree, null, 'empty list renders null');
	panel.unmount();
}
console.log('ok  empty list renders null');

//#region real session replay: parallel P1/P2/P3 + queued Q1 -------------------
// Exact `todo/write` events from session 29f0e492 (the demo the user watched):
// three parallel tasks start together, two finish, the third finishes, and the
// queued Q1 is marked done without ever being observed running.
const events = [
	{ type: 'todo/write', time: 1793199855152, data: { todos: [
		{ content: '并行 P1', status: 'in_progress' },
		{ content: '并行 P2', status: 'in_progress' },
		{ content: '并行 P3', status: 'in_progress' },
		{ content: '排队 Q1', status: 'pending' }
	] } },
	{ type: 'todo/write', time: 1793199974530, data: { todos: [
		{ content: '并行 P1', status: 'completed' },
		{ content: '并行 P2', status: 'completed' },
		{ content: '并行 P3', status: 'in_progress' },
		{ content: '排队 Q1', status: 'pending' }
	] } },
	{ type: 'todo/write', time: 1793199982334, data: { todos: [
		{ content: '并行 P1', status: 'completed' },
		{ content: '并行 P2', status: 'completed' },
		{ content: '并行 P3', status: 'completed' },
		{ content: '排队 Q1', status: 'completed' }
	] } }
];
const afterFirst = foldTodoTimer(null, events[0]);
const midState = foldTodoTimer(afterFirst, events[1]);
let replayed = foldTodoTimer(midState, events[2]);
assert.equal(afterFirst.firstStartedAt, 1793199855152);
assert.equal(replayed.firstStartedAt, 1793199855152);
assert.equal(replayed.completedAt, 1793199982334);

{
	// Mid-flight snapshot: P1/P2 already frozen, P3 still running, Q1 silent.
	intervals.length = 0;
	const panel = mount(events[1].data.todos, midState, 1793199974530);
	panel.toggle();
	assert.deepEqual(panel.items.map((entry) => entry.time), ['1m 59s', '1m 59s', '1m 59s', null]);
	assert.equal(panel.total, '总耗时 1m 59s');
	panel.unmount();
}
{
	// Final snapshot: everything done, Q1 never ran, total frozen at 2m 07s.
	intervals.length = 0;
	const panel = mount(events[2].data.todos, replayed, 1793199982334);
	panel.toggle();
	assert.deepEqual(panel.items.map((entry) => entry.time), ['1m 59s', '1m 59s', '2m 07s', '0s']);
	assert.equal(panel.total, '总耗时 2m 07s');
	assert.equal(panel.liveIntervals().length, 0);
	panel.unmount();
}
console.log('ok  real session replay (P1/P2/P3 parallel + Q1 queued)');

//#region always-on counts + numbered rows -------------------------------------
{
	intervals.length = 0;
	const todos = [
		{ content: '任务1', status: 'completed' },
		{ content: '任务2', status: 'in_progress' },
		{ content: '任务3', status: 'pending' }
	];
	const timer = timerOf([
		item('任务1', 'completed', { startedAt: T, completedAt: T + 30_000 }),
		item('任务2', 'in_progress', { startedAt: T }),
		item('任务3', 'pending')
	], { firstStartedAt: T });
	const panel = mount(todos, timer, T + 45_000);
	panel.toggle();
	assert.deepEqual(panel.items.map((entry) => entry.ordinal), ['1', '2', '3'], 'rows are numbered');
	assert.deepEqual(panel.items.map((entry) => entry.content), ['任务1', '任务2', '任务3']);
	assert.ok(panel.text.includes('1 已完成 · 1 进行中 · 1 待处理'), 'all three counts are always shown');
	assert.equal(panel.items[0].time, '30s');
	assert.equal(panel.items[1].time, '45s');
	assert.equal(panel.items[2].time, null, 'pending has no clock');
	assert.equal(panel.total, '总耗时 45s');
	panel.unmount();
}
console.log('ok  always-on counts + numbered rows');

//#region turn/start: official todos empty, host projection keeps the list ------
{
	intervals.length = 0;
	const todos = []; // the official `todos` projection is null at a turn boundary
	const timer = timerOf([
		item('完成 A', 'completed', { startedAt: T, completedAt: T + 60_000 }),
		item('完成 B', 'completed', { startedAt: null, completedAt: T + 60_000 })
	], { firstStartedAt: T, completedAt: T + 60_000 });
	const panel = mount(todos, timer, T + 120_000);
	panel.toggle();
	assert.ok(panel.tree !== null, 'panel survives turn/start');
	assert.equal(panel.items.length, 2);
	assert.equal(panel.items[0].time, '1m 00s');
	assert.equal(panel.items[1].time, '0s');
	assert.equal(panel.total, '总耗时 1m 00s');
	assert.equal(panel.liveIntervals().length, 0, 'all done: no ticker');
	panel.unmount();
}
console.log('ok  turn/start keeps the panel from the host projection');

//#region retained completed row + total from the host projection --------------
{
	intervals.length = 0;
	const todos = [{ content: 'B', status: 'in_progress' }];
	const timer = timerOf([
		item('A', 'completed', { startedAt: T, completedAt: T + 60_000 }),
		item('B', 'in_progress', { startedAt: T + 60_000 })
	], { firstStartedAt: T });
	const panel = mount(todos, timer, T + 90_000);
	panel.toggle();
	assert.deepEqual(panel.items.map((entry) => entry.content), ['A', 'B'], 'retained completed row is shown');
	assert.deepEqual(panel.items.map((entry) => entry.ordinal), ['1', '2']);
	assert.equal(panel.items[0].time, '1m 00s');
	assert.equal(panel.items[1].time, '30s');
	assert.ok(panel.text.includes('1 已完成 · 1 进行中 · 0 待处理'));
	assert.equal(panel.total, '总耗时 1m 30s');
	panel.unmount();
}
console.log('ok  retained completed row + host total');

//#region all-done but never ran: total 0s -------------------------------------
{
	intervals.length = 0;
	const todos = [{ content: '直接完成', status: 'completed' }];
	const timer = timerOf([
		item('直接完成', 'completed', { startedAt: null, completedAt: T })
	], { firstStartedAt: null, completedAt: T });
	const panel = mount(todos, timer, T + 5_000);
	panel.toggle();
	assert.equal(panel.items[0].time, '0s');
	assert.equal(panel.total, '总耗时 0s', 'all-done list with no run reports 0s');
	assert.equal(panel.liveIntervals().length, 0);
	panel.unmount();
}
console.log('ok  all-done no-run total 0s');

//#region all-pending: three counts, no total ----------------------------------
{
	intervals.length = 0;
	const todos = [{ content: 'P', status: 'pending' }];
	const timer = timerOf([item('P', 'pending')], { firstStartedAt: null });
	const panel = mount(todos, timer, T + 5_000);
	panel.toggle();
	assert.ok(panel.text.includes('0 已完成 · 0 进行中 · 1 待处理'));
	assert.equal(panel.total, null);
	assert.equal(panel.items[0].time, null);
	assert.equal(panel.liveIntervals().length, 0);
	panel.unmount();
}
console.log('ok  all-pending counts, no total');

console.log('ALL RENDER TESTS PASS');
