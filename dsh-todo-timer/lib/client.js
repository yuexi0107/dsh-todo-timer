window.__ModuleLoader__.load({
	id: "dsh-todo-timer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsx = require("react/jsx-runtime");
		let primitives;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch {
			primitives = void 0;
		}

		//#region i18n (self-contained; the dock entry renders without a locale seat)
		function uiLang() {
			let l = "en";
			try {
				l = (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) || (typeof navigator !== "undefined" && navigator.language) || "en";
			} catch {}
			return /^zh/i.test(l) ? "zh" : "en";
		}
		const STRINGS = {
			zh: {
				title: "任务",
				done: (n) => `${n} 已完成`,
				active: (n) => `${n} 进行中`,
				pending: (n) => `${n} 待处理`,
				total: (d) => `总耗时 ${d}`,
				status: { completed: "已完成", in_progress: "进行中", pending: "待处理" }
			},
			en: {
				title: "To-dos",
				done: (n) => `${n} completed`,
				active: (n) => `${n} in progress`,
				pending: (n) => `${n} pending`,
				total: (d) => `total ${d}`,
				status: { completed: "Completed", in_progress: "In progress", pending: "Pending" }
			}
		};
		//#endregion

		//#region duration rendering: smallest unit first — "45s", "2m 05s", "1h 03m 05s"
		function formatDuration(ms) {
			const totalSeconds = Math.max(0, Math.floor(ms / 1000));
			const hours = Math.floor(totalSeconds / 3600);
			const minutes = Math.floor((totalSeconds % 3600) / 60);
			const seconds = totalSeconds % 60;
			if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
			if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
			return `${seconds}s`;
		}
		//#endregion

		//#region styling (mirrors the shipped TodoPanel.module.css with inline styles)
		const S = {
			root: { boxSizing: "border-box", width: "calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))", maxWidth: "calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))", borderRadius: "var(--dsw-radius-lg)", background: "var(--dsw-specific-menu)", backdropFilter: "var(--dsw-menu-backdrop-filter)", boxShadow: "var(--dsw-elevation-panel)", border: 0, flex: "none", margin: "0 auto", overflow: "hidden" },
			body: { flexDirection: "column", gap: 8, padding: "6px 12px", display: "flex" },
			header: { textAlign: "left", cursor: "pointer", background: "transparent", border: "none", alignItems: "center", gap: 10, width: "100%", padding: 0, display: "flex" },
			lead: { color: "var(--dsw-alias-label-tertiary)", flex: "none", placeItems: "center", display: "grid" },
			title: { color: "var(--dsw-alias-label-primary)", flex: "none", fontSize: 13, fontWeight: 500, lineHeight: "24px" },
			progress: { minWidth: 0, color: "var(--dsw-alias-label-tertiary)", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "auto", fontSize: 13, fontWeight: 400, lineHeight: "20px", overflow: "hidden" },
			chevron: { color: "var(--dsw-alias-label-tertiary)", flex: "none", placeItems: "center", display: "grid" },
			list: { flexDirection: "column", gap: 8, maxHeight: 180, margin: 0, padding: 0, listStyle: "none", display: "flex", overflowY: "auto" },
			item: { minWidth: 0, color: "var(--dsw-alias-label-secondary)", alignItems: "center", gap: 10, fontSize: 13, lineHeight: "20px", display: "flex" },
			glyph: { flex: "none", placeItems: "center", width: 16, height: 16, display: "grid" },
			content: { textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden" },
			time: { marginLeft: "auto", flex: "none", color: "var(--dsw-alias-label-tertiary)", fontSize: 12, fontWeight: 400, lineHeight: "20px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }
		};
		//#endregion

		//#region status markers (primitives when available, inline fallback otherwise)
		function statusDotState(status) {
			switch (status) {
				case "completed": return "done";
				case "in_progress": return "ongoing";
				default: return "idle";
			}
		}
		function FallbackDot({ state }) {
			const color = state === "done" ? "var(--dsw-alias-success, #22c55e)" : state === "ongoing" ? "var(--dsw-alias-warning, #f59e0b)" : "var(--dsw-alias-label-quaternary, #9ca3af)";
			return jsx.jsx("span", { style: { width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" } });
		}
		function StateDot({ state }) {
			if (primitives && primitives.StateDot) return jsx.jsx(primitives.StateDot, { state });
			return jsx.jsx(FallbackDot, { state });
		}
		function ChecklistIcon() {
			if (primitives && primitives.IconChecklistOutlineRegular) return jsx.jsx(primitives.IconChecklistOutlineRegular, {});
			return jsx.jsx("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": true, children: jsx.jsx("path", { d: "M2 3.5h9M2 8h9M2 12.5h6M13 12l1.5 1.5L17 10", stroke: "currentColor", strokeWidth: 1.4, fill: "none" }) });
		}
		function Chevron({ up }) {
			const C = up ? primitives && primitives.IconChevronUpOutlineRegular : primitives && primitives.IconChevronDownOutlineRegular;
			if (C) return jsx.jsx(C, {});
			return jsx.jsx("svg", { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": true, children: jsx.jsx("path", { d: up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4", stroke: "currentColor", strokeWidth: 1.4, fill: "none" }) });
		}
		//#endregion

		//#region timing math
		function itemDuration(item, timing, now, listCreatedAt) {
			if (timing === null || timing === void 0) return null;
			if (item.status === "in_progress") {
				const from = timing.startedAt !== null && timing.startedAt !== void 0 ? timing.startedAt : timing.seenAt !== null && timing.seenAt !== void 0 ? timing.seenAt : listCreatedAt;
				if (from === null || from === void 0) return null;
				return formatDuration(Math.max(0, now - from));
			}
			if (item.status === "completed" && timing.completedAt !== null && timing.completedAt !== void 0) {
				const from = timing.startedAt !== null && timing.startedAt !== void 0 ? timing.startedAt : timing.seenAt !== null && timing.seenAt !== void 0 ? timing.seenAt : listCreatedAt;
				if (from === null || from === void 0) return null;
				return formatDuration(Math.max(0, timing.completedAt - from));
			}
			return null;
		}
		//#endregion

		function TodoTimerPanel({ todos, timer }) {
			const lang = STRINGS[uiLang()];
			const [collapsed, setCollapsed] = react.useState(true);
			const [now, setNow] = react.useState(() => Date.now());
			const hasActive = timer !== null && timer !== void 0 && timer.items !== void 0 && timer.items.some((item) => item.status === "in_progress");
			const expanded = !collapsed && todos.length > 0;
			react.useLayoutEffect(() => {
				if (!expanded || !hasActive) return;
				setNow(Date.now());
				const t = setInterval(() => setNow(Date.now()), 1000);
				return () => clearInterval(t);
			}, [expanded, hasActive]);
			if (todos.length === 0) return null;
			const timingOf = timer === null || timer === void 0 || timer.items === void 0 ? /* @__PURE__ */ new Map() : new Map(timer.items.map((item) => [item.content, item]));
			const done = todos.filter((item) => item.status === "completed").length;
			const active = todos.filter((item) => item.status === "in_progress").length;
			const pending = todos.length - done - active;
			let header = [
				...done > 0 ? [lang.done(done)] : [],
				...active > 0 ? [lang.active(active)] : [],
				...pending > 0 ? [lang.pending(pending)] : []
			].join(" · ");
			if (timer !== null && timer !== void 0 && timer.completedAt !== null && timer.completedAt !== void 0 && timer.createdAt !== null && timer.createdAt !== void 0) {
				header = `${header} · ${lang.total(formatDuration(Math.max(0, timer.completedAt - timer.createdAt)))}`;
			}
			return jsx.jsx("section", {
				style: S.root,
				"data-testid": "todo-panel",
				"aria-label": lang.title,
				children: jsx.jsxs("div", {
					style: S.body,
					children: [jsx.jsxs("button", {
						type: "button",
						style: S.header,
						"aria-expanded": !collapsed,
						onClick: () => setCollapsed((v) => !v),
						children: [
							jsx.jsx("span", { style: S.lead, "aria-hidden": true, children: jsx.jsx(ChecklistIcon, {}) }),
							jsx.jsx("span", { style: S.title, children: lang.title }),
							jsx.jsx("span", { style: S.progress, children: header }),
							jsx.jsx("span", { style: S.chevron, "aria-hidden": true, children: jsx.jsx(Chevron, { up: collapsed }) })
						]
					}), !collapsed && jsx.jsx("ul", {
						style: S.list,
						children: todos.map((item) => {
							const duration = itemDuration(item, timingOf.get(item.content) ?? null, now, timer === null || timer === void 0 ? null : timer.createdAt);
							return jsx.jsxs("li", {
								style: S.item,
								"data-status": item.status,
								children: [
									jsx.jsx("span", { style: S.glyph, role: "img", "aria-label": lang.status[item.status] ?? item.status, children: jsx.jsx(StateDot, { state: statusDotState(item.status) }) }),
									jsx.jsx("span", { style: S.content, children: item.content }),
									duration === null ? null : jsx.jsx("span", { style: S.time, children: duration })
								]
							}, item.content);
						})
					})]
				})
			});
		}
		/** Reads both projections and renders the timing to-do panel. */
		function TodoTimerDock({ useProjection }) {
			return jsx.jsx(TodoTimerPanel, {
				todos: useProjection("todos") ?? [],
				timer: useProjection("todoTimer") ?? null
			});
		}

		const name = "client-ui-todo-timer";
		const inject = ["slots"];
		/**
		 * Shadow the shipped todo dock: same slot, same entry id, registered
		 * later, so this panel wins the cell (the documented shadows-shipped-ui
		 * pattern) and the official panel stops rendering.
		 * @param ctx - client context carrying the slots seat.
		 */
		function apply(ctx) {
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "todo",
				order: 0
			}, TodoTimerDock));
		}

		exports.TodoTimerDock = TodoTimerDock;
		exports.TodoTimerPanel = TodoTimerPanel;
		exports.apply = apply;
		exports.formatDuration = formatDuration;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
