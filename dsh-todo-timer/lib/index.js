/**
 * dsh-todo-timer host half: registers the `todoTimer` session projection that
 * folds `todo/write` event wall-clock times into per-item `startedAt` /
 * `completedAt` stamps, plus list-level `firstStartedAt` (the first task's run
 * start) and the legacy `createdAt` / `completedAt` bounds.
 *
 * The key is private to this plugin: it never touches the official `todos`
 * projection, so the shipped panel and this one read the same event log
 * independently and official updates cannot collide with it.
 *
 * 0.3.0 keeps the current list's completed rows: an item that disappears from a
 * later write of the SAME list keeps its frozen timing and stays in `items`.
 * A zero-overlap write is a new list and drops the previous rows.
 *
 * @module dsh-todo-timer
 */
const name = "todo-timer";
const inject = ["sessionProjections"];

/**
 * Fold one `todo/write` snapshot into the timing state, inheriting stamps from
 * the previous list by matching `content`: an item keeps `startedAt` while it
 * stays active, gains it when it becomes active, and freezes `completedAt` at
 * the first event that observes it completed.
 *
 * `firstStartedAt` is the list-level stopwatch origin: the earliest moment a
 * task of the current list was observed running. It is inherited while the list
 * continues (at least one item carried over by exact text) and recomputed when
 * a brand-new list replaces it, so the panel's total time starts with the first
 * task run rather than with the list's creation. The legacy list-level
 * `createdAt` (earliest listing time) and `completedAt` (first all-completed
 * observation) are kept for older readers and for diagnostics.
 *
 * Completed rows are permanent within the current list: when a continuing write
 * omits a completed item, its record is retained at its old position. Only a
 * zero-overlap (new list) or empty write drops the previous rows. A completed
 * item may pass its timeline to a same-index replacement only when that
 * replacement is also completed (a text edit) or open (a reopen under a new
 * name); a fresh queued item never inherits a finished task's duration.
 *
 * Timing survives turn boundaries: the stamps replay from the whole event log,
 * so a session reload restores every frozen duration. `turn/start` re-arms the
 * per-turn clocks but does not clear the current list.
 * @param state - previous timing state (null before the first write).
 * @param event - the committed session event (`time` is its wall-clock ms).
 * @returns the next timing state.
 */
function foldTodoTimer(state, event) {
	if (event.type === "turn/start") {
		// A turn boundary re-arms the per-turn clocks. It must not drop the
		// current list: the panel keeps rendering its rows while the next write
		// is pending, so completed durations never blink out at a turn edge.
		if (state === null) return state;
		return {
			...state,
			turnStartedAt: event.time,
			lastWriteInTurn: null
		};
	}
	if (event.type !== "todo/write") return state;
	const now = event.time;
	const prevItems = state === null ? [] : state.items;
	const byContent = new Map(prevItems.map((item) => [item.content, item]));
	const incomingContents = new Set(event.data.todos.map((item) => item.content));
	// Continuation detection: at least one item carried over by exact text.
	// A zero-overlap write is a brand-new list, where positional matching
	// would graft unrelated old timelines onto fresh items.
	const overlap = event.data.todos.reduce((count, item) => count + (byContent.has(item.content) ? 1 : 0), 0);
	const continuation = overlap > 0;
	const consumed = new Set();
	let sawNewCompletion = false;
	const items = event.data.todos.map((incoming, index) => {
		let old = byContent.get(incoming.content);
		if (old === void 0 && continuation) {
			// Rename inheritance: the model edits item text between writes, which
			// breaks content matching. A vanished non-completed item (still running
			// or still queued) may pass its timeline to the fresh text at its index.
			// A completed item may pass its timeline only to a completed or open
			// replacement (a text edit or a reopen under a new name); replacing a
			// finished task with a fresh queued one must not graft its duration.
			const positional = prevItems[index];
			if (positional !== void 0 && !incomingContents.has(positional.content)) {
				const allow = positional.status !== "completed" || incoming.status !== "pending";
				if (allow) {
					old = positional;
					consumed.add(positional.content);
				}
			}
		}
		// A brand-new item with no inherited timeline: one first listed as open
		// (pending/in_progress) starts at this write; one first reported already
		// completed did its work since this turn's previous list write, or since
		// the turn began when this is the turn's first write. Those boundaries
		// are honest lower bounds — never a fabricated old duration, never a
		// misleading zero for work that visibly took time.
		const seenAt = old !== void 0 && old.seenAt !== null && old.seenAt !== void 0 ? old.seenAt : incoming.status === "completed" && state !== null ? state.lastWriteInTurn !== null && state.lastWriteInTurn !== void 0 ? state.lastWriteInTurn : state.turnStartedAt !== null && state.turnStartedAt !== void 0 ? state.turnStartedAt : now : now;
		let startedAt = null;
		let completedAt = null;
		if (incoming.status === "in_progress") {
			startedAt = old !== void 0 && old.status === "in_progress" && old.startedAt !== null ? old.startedAt : now;
		} else if (incoming.status === "completed") {
			completedAt = old !== void 0 && old.completedAt !== null ? old.completedAt : now;
			// A completion first observed in this write (a new item, or an open
			// item that just finished) must move the list-level completion stamp
			// forward even when the previous list was already all-complete.
			if (old === void 0 || old.completedAt === null) sawNewCompletion = true;
			startedAt = old !== void 0 && old.startedAt !== null ? old.startedAt : null;
		}
		return {
			content: incoming.content,
			status: incoming.status,
			seenAt,
			startedAt,
			completedAt
		};
	});
	// Completed rows of a continuing list are permanent: keep each one the new
	// snapshot omitted, at (approximately) its old position. Queued or running
	// rows that vanished are dropped — only finished work is retained.
	if (continuation) {
		for (let index = 0; index < prevItems.length; index++) {
			const old = prevItems[index];
			if (old.status !== "completed") continue;
			if (incomingContents.has(old.content)) continue;
			if (consumed.has(old.content)) continue;
			items.splice(Math.min(index, items.length), 0, old);
		}
	}
	// The list-level stopwatch origin: keep the previous origin while the list
	// continues, otherwise take the earliest run start this new list has seen.
	let firstStartedAt = null;
	if (continuation && state !== null && state.firstStartedAt !== null && state.firstStartedAt !== void 0) firstStartedAt = state.firstStartedAt;
	if (firstStartedAt === null) {
		for (const item of items) {
			if (item.startedAt === null || item.startedAt === void 0) continue;
			if (firstStartedAt === null || item.startedAt < firstStartedAt) firstStartedAt = item.startedAt;
		}
	}
	const createdAt = items.length === 0 ? now : items.reduce((min, item) => item.seenAt < min ? item.seenAt : min, items[0].seenAt);
	const allDone = items.length > 0 && items.every((item) => item.status === "completed");
	const prevAllDone = state !== null && state.items.length > 0 && state.items.every((item) => item.status === "completed");
	let completedAt = null;
	// Keep the previous stamp only while the SAME list stays all-complete and no
	// item completed in this write. A brand-new list, or a newly completed item,
	// starts a new list completion stamp.
	if (allDone) completedAt = !sawNewCompletion && continuation && prevAllDone && state !== null && state.completedAt !== null ? state.completedAt : now;
	return {
		items,
		createdAt,
		completedAt,
		firstStartedAt,
		lastWriteInTurn: now
	};
}

/** The projection values are built by the fold itself; the schema is a pass-through. */
const passThrough = { parse: (value) => value };

/**
 * Register the `todoTimer` unit on `ctx.sessionProjections`.
 * @param ctx - registrant context carrying the session-projection registry.
 */
function apply(ctx) {
	ctx.sessionProjections.register({
		key: "todoTimer",
		stateSchema: passThrough,
		init: () => null,
		apply: foldTodoTimer,
		wire: {
			viewSchema: passThrough,
			view: (state) => state
		},
		stateVersion: 8
	});
}

export { apply, foldTodoTimer, inject, name };
