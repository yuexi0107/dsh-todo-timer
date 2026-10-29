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
 * 0.3.1 makes completed rows permanent for the WHOLE conversation: when a later
 * write replaces or clears the current list, its completed rows are archived and
 * stay in `items` with their frozen timing. Only a new conversation starts with
 * no history, so the panel disappears there like the shipped panel does.
 * `firstStartedAt` is likewise conversation-wide; the total never resets while
 * the conversation continues.
 *
 * @module dsh-todo-timer
 */
const name = "todo-timer";
const inject = ["sessionProjections"];

/**
 * Fold one `todo/write` snapshot into the timing state.
 *
 * `items` is the display list: archived completed rows (from earlier lists of
 * this conversation) followed, in first-seen order, by the current list's rows.
 * Each item carries `order` (stable display order) and `archived` (true once the
 * item left the current list but is kept because it completed).
 *
 * A current item keeps its timeline while it stays active, freezes
 * `completedAt` when it completes, and is archived if a later write omits it
 * after completion. Current pending/in_progress items omitted by a later write
 * are dropped — only finished work is permanent. An incoming item may reopen an
 * archived item by matching its content, or inherit a vanished current item's
 * timeline at the same index (text edit).
 *
 * `firstStartedAt` is the conversation-level stopwatch origin: the earliest
 * moment any task was observed running. It is inherited across list changes and
 * never moves backwards. `completedAt` is the latest completion once every
 * displayed row is completed; it clears when new work is added, so the total
 * resumes. `turn/start` re-arms the per-turn clocks but never clears the list.
 *
 * Timing survives turn boundaries and reloads: the stamps replay from the whole
 * event log, so every frozen duration is restored. A new conversation has no
 * events and therefore no panel.
 *
 * @param state - previous timing state (null before the first write).
 * @param event - the committed session event (`time` is its wall-clock ms).
 * @returns the next timing state.
 */
function foldTodoTimer(state, event) {
	if (event.type === "turn/start") {
		// A turn boundary re-arms the per-turn clocks. It must not drop the
		// current list or its history: the panel keeps rendering every completed
		// row while the next write is pending.
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
	const prevCurrent = prevItems.filter((item) => item.archived !== true);
	const byContentAll = new Map();
	for (const item of prevItems) if (!byContentAll.has(item.content)) byContentAll.set(item.content, item);
	const byContentCurrent = new Map(prevCurrent.map((item) => [item.content, item]));
	const incomingContents = new Set(event.data.todos.map((item) => item.content));
	// A write continues the CURRENT list only when at least one current row is
	// carried over by exact text. A zero-overlap write is a new list: positional
	// rename inheritance must not graft an old completed row onto a fresh plan.
	const currentOverlap = prevCurrent.reduce((count, item) => count + (incomingContents.has(item.content) ? 1 : 0), 0);
	const continuation = currentOverlap > 0;
	const consumed = new Set();
	const matched = new Set();
	let nextOrder = state !== null && typeof state.nextOrder === "number"
		? state.nextOrder
		: prevItems.reduce((max, item) => Math.max(max, typeof item.order === "number" ? item.order : 0), 0) + (prevItems.length > 0 ? 1 : 0);
	const incomingItems = event.data.todos.map((incoming, index) => {
		let old = byContentCurrent.get(incoming.content);
		if (old === void 0) old = byContentAll.get(incoming.content);
		if (old === void 0 && continuation) {
			// Rename inheritance: the model edits item text between writes, which
			// breaks content matching. A vanished current item may pass its
			// timeline to the fresh text at its index. A completed item may pass
			// its timeline only to a completed or open replacement (a text edit or
			// a reopen under a new name); a fresh queued item never inherits a
			// finished task's duration.
			const positional = prevCurrent[index];
			if (positional !== void 0 && !incomingContents.has(positional.content)) {
				const allow = positional.status !== "completed" || incoming.status !== "pending";
				if (allow) {
					old = positional;
					consumed.add(positional.content);
				}
			}
		}
		if (old !== void 0) {
			matched.add(old);
			let startedAt = old.startedAt;
			let completedAt = old.completedAt;
			if (incoming.status === "in_progress") {
				startedAt = old.status === "in_progress" && old.startedAt !== null && old.startedAt !== void 0 ? old.startedAt : now;
				completedAt = null;
			} else if (incoming.status === "completed") {
				completedAt = old.completedAt !== null && old.completedAt !== void 0 ? old.completedAt : now;
				startedAt = old.startedAt !== null && old.startedAt !== void 0 ? old.startedAt : null;
			} else {
				startedAt = null;
				completedAt = null;
			}
			return {
				content: incoming.content,
				status: incoming.status,
				seenAt: old.seenAt,
				startedAt,
				completedAt,
				order: old.order,
				archived: false
			};
		}
		// A brand-new item with no inherited timeline: one first listed as open
		// (pending/in_progress) starts at this write; one first reported already
		// completed did its work since this turn's previous list write, or since
		// the turn began when this is the turn's first write. Those boundaries
		// are honest lower bounds — never a fabricated old duration, never a
		// misleading zero for work that visibly took time.
		const seenAt = incoming.status === "completed" && state !== null
			? state.lastWriteInTurn !== null && state.lastWriteInTurn !== void 0
				? state.lastWriteInTurn
				: state.turnStartedAt !== null && state.turnStartedAt !== void 0
					? state.turnStartedAt
					: now
			: now;
		let startedAt = null;
		let completedAt = null;
		if (incoming.status === "in_progress") startedAt = now;
		else if (incoming.status === "completed") completedAt = now;
		return {
			content: incoming.content,
			status: incoming.status,
			seenAt,
			startedAt,
			completedAt,
			order: nextOrder++,
			archived: false
		};
	});
	// Keep every previous row that was not matched:
	//   * archived completed rows stay archived;
	//   * a completed current row omitted by this write is archived;
	//   * an open current row omitted by this write is dropped.
	const retained = [];
	for (const item of prevItems) {
		if (matched.has(item) || consumed.has(item.content)) continue;
		if (item.archived === true) {
			retained.push(item);
		} else if (item.status === "completed") {
			retained.push({ ...item, archived: true });
		}
	}
	const items = [...retained, ...incomingItems].sort((a, b) => a.order - b.order);
	// Conversation-level stopwatch origin: inherit the first run start and never
	// reset it while the conversation continues.
	let firstStartedAt = state !== null && state.firstStartedAt !== null && state.firstStartedAt !== void 0 ? state.firstStartedAt : null;
	if (firstStartedAt === null) {
		for (const item of items) {
			if (item.startedAt === null || item.startedAt === void 0) continue;
			if (firstStartedAt === null || item.startedAt < firstStartedAt) firstStartedAt = item.startedAt;
		}
	}
	const createdAt = items.length === 0 ? now : items.reduce((min, item) => item.seenAt < min ? item.seenAt : min, items[0].seenAt);
	const allDone = items.length > 0 && items.every((item) => item.status === "completed");
	let completedAt = null;
	if (allDone) {
		let latest = null;
		for (const item of items) {
			if (item.completedAt === null || item.completedAt === void 0) continue;
			if (latest === null || item.completedAt > latest) latest = item.completedAt;
		}
		completedAt = latest === null ? now : latest;
	}
	return {
		items,
		createdAt,
		completedAt,
		firstStartedAt,
		lastWriteInTurn: now,
		turnStartedAt: state !== null && state.turnStartedAt !== void 0 ? state.turnStartedAt : null,
		nextOrder
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
		stateVersion: 9
	});
}

export { apply, foldTodoTimer, inject, name };
