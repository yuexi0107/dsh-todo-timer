// Robust session-log reader: reassemble lines across zstd frame boundaries,
// dump the last todo/write events, and replay the fold on the FULL event stream.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
const { foldTodoTimer } = await import(pathToFileURL('./lib/index.js').href);

const LOG = 'C:\\Users\\XTS\\.dsh\\sessions\\--C-Users-XTS-Desktop-~5DE5~5355~8F6F~4EF6~8BF4~660E~4E66--\\session-29f0e492-f2fa-4abe-a80f-eebadb1e35d5\\session.v4.jsonl.zstd';
const raw = fs.readFileSync(LOG);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const frames = [];
let start = 0;
for (;;) { const next = raw.indexOf(MAGIC, start + 4); if (next < 0) break; frames.push(raw.subarray(start, next)); start = next; }
frames.push(raw.subarray(start));

// Decompress frame by frame, carrying the trailing partial line across boundaries.
const events = [];
let carry = '';
let dropped = 0;
for (const frame of frames) {
	const chunk = carry + zlib.zstdDecompressSync(frame).toString('utf8');
	const lines = chunk.split('\n');
	carry = lines.pop();
	for (const line of lines) {
		if (!line.trim()) continue;
		try { events.push(JSON.parse(line)); } catch { dropped++; }
	}
}
if (carry.trim()) { try { events.push(JSON.parse(carry)); } catch { dropped++; } }
console.log('frames:', frames.length, 'events:', events.length, 'unparseable lines:', dropped);

const writes = events.filter((e) => e.type === 'todo/write');
const fmt = (ms) => {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
	return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s` : m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};
console.log('\nlast', Math.min(6, writes.length), 'writes:');
for (const w of writes.slice(-6)) {
	const t = new Date(w.time).toLocaleTimeString('zh-CN', { hour12: false });
	const summary = w.data.todos.map((i) => `${i.content.slice(3, 4)}${i.status === 'completed' ? '✓' : i.status === 'in_progress' ? '▶' : '·'}`).join(' ');
	console.log(`  ${t}  [${summary}]`);
}
console.log('\nintervals between last writes (s):');
const tail = writes.slice(-6);
for (let i = 1; i < tail.length; i++) console.log(`  ${Math.round((tail[i].time - tail[i - 1].time) / 1000)}s`);

// Full fold replay over the event stream in order.
let state = null;
for (const e of events) state = foldTodoTimer(state, e);
console.log('\nfold result (what the panel shows):');
for (const item of state.items) {
	const from = item.startedAt ?? item.seenAt ?? state.createdAt;
	let dur = '—';
	if (item.status === 'in_progress') dur = fmt(Date.now() - from);
	else if (item.status === 'completed' && item.completedAt !== null) dur = fmt(item.completedAt - from);
	console.log(`  [${item.status.padEnd(11)}] ${dur.padStart(10)}  ${item.content}`);
}
if (state.completedAt !== null) console.log('  TOTAL:', fmt(state.completedAt - state.createdAt));
