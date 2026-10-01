/**
 * Regression test for the streaming transcript parsing.
 *
 * It replays the exact event sequence xAI sent for a real Russian recording
 * (captured in ~/.dsh/voice-stream.log): the recognised text arrives in
 * `transcript.partial` and the closing `transcript.done` carries an empty
 * `text`. A fake WebSocket stands in for the provider, so the plugin's own host
 * handler is exercised end to end without any network or credential.
 *
 *   node test/stream-check.mjs
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep the host half away from the real configuration file.
process.env.APPDATA = mkdtempSync(join(tmpdir(), "dsh-voice-"));
delete process.env.USERPROFILE;

const RECOGNISED = "Я вот прямо щас нажал микрофон и хочу посмотреть, что получилось.";

const failures = [];
function check(label, condition, detail) {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures.push(label);
	console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail).slice(0, 160)}`}`);
}

/** Scripted provider socket: emits the captured xAI event sequence. */
let script = [];
class FakeSocket {
	static instance = null;
	constructor(url, options) {
		FakeSocket.instance = this;
		this.url = url;
		this.options = options;
		this.listeners = new Map();
		this.sent = [];
		queueMicrotask(() => this.emit("open", {}));
	}
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(listener);
	}
	emit(type, event) {
		for (const listener of this.listeners.get(type) ?? []) listener({ data: undefined, ...event });
	}
	send(data) {
		this.sent.push(data);
		if (typeof data !== "string") return;
		let message = null;
		try { message = JSON.parse(data); } catch { return; }
		if (message.type !== "audio.done") return;
		// The provider answers a finished stream with the captured events.
		for (const event of script) {
			const payload = typeof event === "function" ? event() : event;
			if (payload === null) continue;
			queueMicrotask(() => this.emit("message", { data: JSON.stringify(payload) }));
		}
	}
	close() {
		queueMicrotask(() => this.emit("close", { code: 1000, reason: "" }));
	}
}
globalThis.WebSocket = FakeSocket;

const { apply } = await import("../index.js");

/** Canonical 16 kHz mono PCM16 WAV of the requested length. */
function wav(seconds) {
	const dataBytes = Math.round(16000 * seconds) * 2;
	const buffer = Buffer.alloc(44 + dataBytes);
	buffer.write("RIFF", 0, "ascii");
	buffer.writeUInt32LE(36 + dataBytes, 4);
	buffer.write("WAVE", 8, "ascii");
	buffer.write("fmt ", 12, "ascii");
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(16000, 24);
	buffer.writeUInt32LE(32000, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36, "ascii");
	buffer.writeUInt32LE(dataBytes, 40);
	return buffer;
}

let handler;
apply({ effect(callback) { callback(); }, webServer: { register(route) { handler = route.handler; } } }, {
	url: "wss://provider.invalid/v1/stt",
	apiKey: "test-key",
	model: "test-model"
});
check("host half registers its route", typeof handler === "function");

async function transcribe(seconds) {
	const body = JSON.stringify({ audioBase64: wav(seconds).toString("base64"), format: "wav" });
	const request = {
		method: "POST",
		url: "/api/voice-input/transcribe",
		on(event, callback) {
			if (event === "data") callback(body);
			if (event === "end") callback();
		}
	};
	let status = 0;
	let payload = "";
	await handler(request, {
		writeHead(code) { status = code; },
		end(text) { payload = text; }
	});
	return { status, payload: JSON.parse(payload) };
}

console.log("the captured xAI sequence (partial carries the text, done is empty)");
script = [
	{ type: "transcript.created", id: "97723be9" },
	{ type: "transcript.partial", text: RECOGNISED, words: [] },
	{ type: "transcript.partial", text: RECOGNISED, words: [] },
	{ type: "transcript.done", text: "", words: [], duration: 5.28 }
];
const captured = await transcribe(5.28);
check("answers with HTTP 200", captured.status === 200, `HTTP ${captured.status}`);
check("returns the recognised Russian text", captured.payload.text === RECOGNISED, JSON.stringify(captured.payload).slice(0, 200));

console.log("a provider that closes with text in transcript.done");
script = [
	{ type: "transcript.created", id: "a" },
	{ type: "transcript.done", text: "Готово, проверка связи.", words: [], duration: 1.2 }
];
const finalOnly = await transcribe(1.2);
check("uses the final text when it is present", finalOnly.payload.text === "Готово, проверка связи.", JSON.stringify(finalOnly.payload).slice(0, 200));

console.log("cumulative partials");
script = [
	{ type: "transcript.created", id: "b" },
	{ type: "transcript.partial", text: "Проверка" },
	{ type: "transcript.partial", text: "Проверка голосового ввода" },
	{ type: "transcript.done", text: "" }
];
const cumulative = await transcribe(2);
check("keeps the longest partial, not a concatenation", cumulative.payload.text === "Проверка голосового ввода", JSON.stringify(cumulative.payload).slice(0, 200));

console.log("silence");
script = [
	{ type: "transcript.created", id: "c" },
	{ type: "transcript.done", text: "", words: [], duration: 0.5 }
];
const silence = await transcribe(0.5);
check("silence still reports no speech", silence.status === 502 && /No speech was recognised/.test(silence.payload.error), JSON.stringify(silence.payload).slice(0, 200));

console.log("transport failure");
script = [null];
const failing = await transcribe(0.5).catch((error) => ({ status: 0, payload: { error: error.message } }));
check("a socket that never answers is reported, not hidden", failing.status === 0 || failing.status === 502, JSON.stringify(failing.payload).slice(0, 160));

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
