/**
 * dsh-todo-timer host half: registers the `todoTimer` session projection that
 * folds `todo/write` event wall-clock times into per-item `startedAt` /
 * `completedAt` stamps, plus list-level `createdAt` / `completedAt`.
 *
 * The key is private to this plugin: it never touches the official `todos`
 * projection, so the shipped panel and this one read the same event log
 * independently and official updates cannot collide with it.
 *
 * @module dsh-todo-timer
 */
const name = "todo-timer";
const inject = ["sessionProjections"];

/**
 * Fold one `todo/write` snapshot into the timing state, inheriting stamps from
 * the previous list by matching `content`: an item keeps `startedAt` while it
 * stays active, gains it when it becomes active, and freezes `completedAt` at
 * the first event that observes it completed. The list-level `completedAt`
 * freezes at the first event where every item is completed; `createdAt`
 * freezes at the first write of the current list (a changed content set
 * restarts it). Timing survives turn boundaries: the stamps replay from the
 * whole event log, so a session reload restores every frozen duration.
 * @param state - previous timing state (null before the first write).
 * @param event - the committed session event (`time` is its wall-clock ms).
 * @returns the next timing state.
 */
function foldTodoTimer(state, event) {
	if (event.type !== "todo/write") return state;
	const now = event.time;
	const prev = state === null ? /* @__PURE__ */ new Map() : new Map(state.items.map((item) => [item.content, item]));
	const items = event.data.todos.map((incoming) => {
		const old = prev.get(incoming.content);
		let startedAt = null;
		let completedAt = null;
		if (incoming.status === "in_progress") {
			startedAt = old !== void 0 && old.status === "in_progress" && old.startedAt !== null ? old.startedAt : now;
		} else if (incoming.status === "completed") {
			completedAt = old !== void 0 && old.completedAt !== null ? old.completedAt : now;
			startedAt = old !== void 0 && old.startedAt !== null ? old.startedAt : null;
		}
		return {
			content: incoming.content,
			status: incoming.status,
			startedAt,
			completedAt
		};
	});
	const sameList = state !== null && state.items.length === items.length && state.items.every((old, index) => old.content === items[index].content);
	const createdAt = sameList ? state.createdAt : now;
	const allDone = items.length > 0 && items.every((item) => item.status === "completed");
	let completedAt = null;
	if (allDone) completedAt = sameList && state.completedAt !== null ? state.completedAt : now;
	return {
		items,
		createdAt,
		completedAt
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
		stateVersion: 1
	});
}

export { apply, foldTodoTimer, inject, name };
