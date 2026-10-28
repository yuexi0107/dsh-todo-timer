// Replay the real session log through the fixed fold: prove the "0s" items recover.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const LOG = 'C:\\Users\\XTS\\.dsh\\sessions\\--C-Users-XTS-Desktop-~5DE5~5355~8F6F~4EF6~8BF4~660E~4E66--\\session-29f0e492-f2fa-4abe-a80f-eebadb1e35d5\\session.v4.jsonl.zstd';
const { foldTodoTimer } = await import(pathToFileURL('./lib/index.js').href);

// The log is a concatenation of zstd frames; split on the magic and decompress each.
const raw = fs.readFileSync(LOG);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const parts = [];
let start = 0;
for (;;) {
	const next = raw.indexOf(MAGIC, start + 4);
	if (next < 0) break;
	parts.push(raw.subarray(start, next));
	start = next;
}
parts.push(raw.subarray(start));
const text = parts.map((frame) => zlib.zstdDecompressSync(frame).toString('utf8')).join('\n');
const lines = text.split('\n').filter((l) => l.trim());
console.log('frames:', parts.length, 'lines:', lines.length);

let state = null;
let writes = 0;
let turns = 0;
for (const line of lines) {
	let event;
	try { event = JSON.parse(line); } catch { continue; }
	if (event.type === 'todo/write') writes++;
	if (event.type === 'turn/start') turns++;
	state = foldTodoTimer(state, event);
}
console.log('todo/write events replayed:', writes, '| turn/start:', turns);
if (state === null) { console.log('NO TIMING STATE'); process.exitCode = 1; }
else {
	const fmt = (ms) => {
		const s = Math.max(0, Math.floor(ms / 1000));
		const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
		return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s` : m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
	};
	const now = Date.now();
	for (const item of state.items) {
		let dur = '—';
		if (item.status === 'in_progress') {
			const from = item.startedAt ?? item.seenAt;
			if (from !== null) dur = fmt(now - from);
		} else if (item.status === 'completed' && item.startedAt !== null && item.completedAt !== null) {
			dur = fmt(item.completedAt - item.startedAt);
		}
		console.log(`[${item.status.padEnd(11)}] ${dur.padStart(10)}  ${item.content}`);
	}
	if (state.firstStartedAt !== null) {
		const end = state.completedAt !== null ? state.completedAt : now;
		console.log('TOTAL:', fmt(end - state.firstStartedAt));
	}
}
