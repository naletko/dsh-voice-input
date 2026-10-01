/**
 * Isolated check for the moved Voice Provider Settings surface.
 *
 * client.js is not a normal module: it registers itself with DSH's browser
 * module loader. This harness supplies the loader, a minimal React stand-in and
 * the slot service, then verifies that the client half still loads, that the
 * composer keeps only the microphone, and that the settings form registers on
 * the plugin page instead.
 *
 *   node test/settings-check.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "client.js"), "utf8");

const failures = [];
function check(label, condition, detail) {
	if (condition) {
		console.log(`  ok   ${label}`);
		return;
	}
	failures.push(label);
	const short = detail === undefined ? "" : ` — ${String(detail).slice(0, 140)}`;
	console.log(`  FAIL ${label}${short}`);
}

// Minimal React stand-in: enough for one render pass of the settings form.
const tree = { text: [] };
function createElement(type, props, ...children) {
	const node = { type, props: props ?? {}, children: children.flat() };
	if (typeof type === "string") {
		for (const child of node.children) if (typeof child === "string") tree.text.push(child);
	}
	return node;
}
const react = {
	createElement,
	useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
	useEffect() {},
	useRef(value) { return { current: value }; },
	useCallback(fn) { return fn; }
};

const registrations = [];
let moduleRecord;
globalThis.window = {
	localStorage: { getItem: () => null, setItem: () => {} },
	__ModuleLoader__: {
		load(record) { moduleRecord = record; }
	}
};

// Load the client half exactly the way the browser loader does.
new Function("window", "require", source)(globalThis.window, (id) => {
	if (id === "react") return react;
	throw new Error(`unexpected require: ${id}`);
});

console.log("client module");
check("registers itself with the module loader", moduleRecord?.id === "dsh-voice-input", moduleRecord?.id
);
const client = moduleRecord.factory((id) => {
	if (id === "react") return react;
	throw new Error(`unexpected require: ${id}`);
});
check("exposes apply()", typeof client?.apply === "function");

const ctx = {
	slots: {
		inject(name, callback) { callback(); },
		register(slot, component) { registrations.push({ slot, component }); }
	}
};
client.apply(ctx);

console.log("slot registrations");
const composer = registrations.find((entry) => entry.slot.name === "conversation.input.activity");
const bundleConfig = registrations.find((entry) => entry.slot.name === "plugins.bundle.config");
const rowConfig = registrations.find((entry) => entry.slot.name === "plugins.row.config");
check("composer keeps the recorder slot", composer !== undefined);
check("bundle config slot is keyed by the package", bundleConfig?.slot.key === "dsh-voice-input", bundleConfig?.slot.key);
check("row config slot is keyed by package#row", rowConfig?.slot.key === "dsh-voice-input#voice-input", rowConfig?.slot.key);
check("no settings button is left in the composer", !/aria-label': 'Voice settings'/.test(source));
check("the composer microphone remains", /aria-label': 'Record voice'/.test(source));

console.log("settings form renders");
const summary = bundleConfig.component({ view: "summary" });
check("summary view is a one-liner", typeof summary === "string" && summary.length > 0, String(summary));
const page = bundleConfig.component({ view: "page" });
check("page view returns a component", typeof page?.type === "function");
const rendered = page.type({});
check("form renders without throwing", rendered !== undefined);
for (const label of ["Provider API Base URL", "API Key", "Model ID"]) {
	check(`form shows ${label}`, tree.text.includes(label));
}

// The form uses the plugin's own DSH-styled field classes, not the old modal ones.
const formElements = [];
(function walkForm(node) {
	if (node === null || node === undefined || typeof node !== "object") return;
	if (Array.isArray(node)) { node.forEach(walkForm); return; }
	if (node.props) formElements.push(node);
	for (const child of node.children ?? []) walkForm(child);
})(rendered);
const formClasses = formElements.map((element) => element.props.className).filter(Boolean);
check("form is a dsh-vr-form container", formClasses.includes("dsh-vr-form"), formClasses.slice(0, 6).join(" | "));
check("each field uses the styled input", formClasses.filter((name) => name === "dsh-vr-field-input").length === 3, String(formClasses.filter((name) => name === "dsh-vr-field-input").length));
check("the old modal classes are gone from the form", !formClasses.some((name) => /dsh-vr-input|dsh-vr-modal-btn/.test(name)), formClasses.join(" | "));
check("the key field masks its value", formElements.some((element) => element.props.className === "dsh-vr-field-input" && element.props.type === "password"));
check("a primary action carries the accent", formClasses.some((name) => name.includes("dsh-vr-action-primary")), formClasses.join(" | "));
check("the form explains the streaming endpoint", tree.text.some((text) => /wss:\/\/api\.x\.ai\/v1\/stt/.test(text)) || JSON.stringify(rendered).includes("wss://api.x.ai/v1/stt"));

console.log("transcribe reads the freshest saved settings");
check("send path no longer uses the stale state copy", /const latest = loadSavedConfig\(\)/.test(source) && /url: latest\.url/.test(source));

console.log("voice bar");
const barSlot = registrations.find((entry) => entry.slot.name === "conversation.input.overlay");
check("bar registers over the composer input", barSlot !== undefined && barSlot.slot.id === "voice-input-bar");
check("bar is no longer rendered beside Send", !/h\(WaveStrip/.test(source.slice(source.indexOf("return h('div', { className: 'dsh-vr-container' }"))));
check("recording hands its view to the bar", /recorderView\.publish\(\{/.test(source));
check("the wave is drawn on a canvas", /className: 'dsh-vr-bar-wave'/.test(source) && /getContext\('2d'\)/.test(source));
check("the live wave follows an analyser", /createAnalyser\(\)/.test(source) && /getByteTimeDomainData/.test(source));
check("reduced motion is honoured", /prefers-reduced-motion/.test(source));
check("review shows a playhead", /progress > 0 && progress < 1/.test(source) && /moveTo\(x, 2\)/.test(source));
check("the bar carries round controls", /dsh-vr-round/.test(source) && /dsh-vr-round-send/.test(source) && /dsh-vr-round-stop/.test(source));
check("no seconds counter in the bar markup", !/className: 'dsh-vr-timer'|className: 'dsh-vr-strip-time'/.test(source));

// Render the recorder so it publishes its view, then render the dock host.
// Effects are queued and flushed after the component body, exactly as React
// runs them after a commit: running them inside the body would touch const
// bindings that are not initialised yet.
const pendingEffects = [];
function flushEffects() {
	for (const effect of pendingEffects.splice(0)) {
		try { effect(); } catch { /* host APIs are absent in this harness */ }
	}
}
let modeOverride = "recording";
const recorderHooks = {
	createElement,
	useState(initial) {
		// The recorder asks for 'idle' first; drive it to the mode under test so
		// the published view carries the state being inspected.
		return [initial === "idle" ? modeOverride : (typeof initial === "function" ? initial() : initial), () => {}];
	},
	useEffect(callback) { pendingEffects.push(callback); },
	useRef(value) { return { current: value ?? null }; },
	useCallback(fn) { return fn; }
};
const clientForStrip = moduleRecord.factory((id) => {
	if (id === "react") return recorderHooks;
	throw new Error(`unexpected require: ${id}`);
});
const stripRegistrations = [];
clientForStrip.apply({
	slots: {
		inject(name, callback) { callback(); },
		register(slot, component) { stripRegistrations.push({ slot, component }); }
	}
});
const recorder = stripRegistrations.find((entry) => entry.slot.name === "conversation.input.activity").component;
const stripHost = stripRegistrations.find((entry) => entry.slot.name === "conversation.input.overlay").component;

/** Shallow-render a tree and collect its host classes and text children. */
function inspect(node) {
	const elements = [];
	(function collect(current, depth) {
		if (current === null || current === undefined || depth > 8) return;
		if (Array.isArray(current)) { current.forEach((child) => collect(child, depth)); return; }
		if (typeof current !== "object") return;
		if (typeof current.type === "function") {
			let rendered = null;
			try { rendered = current.type({ ...current.props, children: current.children }); } catch { rendered = null; }
			collect(rendered, depth + 1);
			return;
		}
		if (current.props) elements.push(current);
		for (const child of current.children ?? []) collect(child, depth);
	})(node, 0);
	return {
		elements,
		classes: elements.map((element) => element.props.className).filter(Boolean),
		texts: elements.flatMap((element) => (element.children ?? []).filter((child) => typeof child === "string"))
	};
}

/** Render both halves for one recorder mode. */
function renderMode(mode) {
	modeOverride = mode;
	pendingEffects.length = 0;
	let tree = null;
	try {
		tree = recorder({ onActiveChange() {}, inputActions: {}, sessionId: "check" });
		flushEffects();
	} catch (error) {
		tree = error;
	}
	let capsule = null;
	try {
		capsule = stripHost({});
		flushEffects();
	} catch (error) {
		capsule = error;
	}
	return { tree, capsule, toolbar: inspect(tree), bar: capsule instanceof Error ? null : inspect(capsule) };
}

const recording = renderMode("recording");
check("recorder renders with the microphone only", !(recording.tree instanceof Error), recording.tree?.message);
check("bar host renders the capsule from the published view", recording.capsule !== null && !(recording.capsule instanceof Error), recording.capsule === null ? "rendered nothing" : recording.capsule?.message);

const classes = recording.bar.classes;
check("capsule container is present", classes.includes("dsh-vr-bar"), classes.slice(0, 6).join(", "));
check("capsule hosts the wave canvas", classes.includes("dsh-vr-bar-wave"));
check("capsule has round controls", classes.filter((name) => name.startsWith("dsh-vr-round")).length >= 4, String(classes.filter((name) => name.startsWith("dsh-vr-round")).length));
check("discard sits on the left, send on the right", classes.some((name) => name === "dsh-vr-round") && classes.some((name) => name.includes("dsh-vr-round-send")), classes.join(" | "));
check("a stop control is ringed, like the reference", classes.some((name) => name.includes("dsh-vr-round-stop")), classes.join(" | "));
check("no text labels inside the capsule", recording.bar.elements
	.filter((element) => element.type !== "style")
	.every((element) => (element.children ?? []).every((child) => typeof child !== "string" || child.trim() === "")), JSON.stringify(recording.bar.texts.slice(0, 5)));
check("the capsule carries its own stylesheet", recording.bar.elements.some((element) => element.type === "style"));
check("the settings form carries its own stylesheet", formElements.some((element) => element.type === "style"));

console.log("feedback around the microphone");
const sending = renderMode("sending");
check("the capsule is gone while the audio is on its way", sending.capsule === null);
check("waiting shows as a spinner beside the microphone", sending.toolbar.classes.some((name) => name.includes("dsh-vr-spinner")), sending.toolbar.classes.join(" | "));
const success = renderMode("success");
check("the capsule is gone once the text is inserted", success.capsule === null);
check("success shows a check beside the microphone", success.toolbar.classes.some((name) => name.includes("dsh-vr-check")), success.toolbar.classes.join(" | "));
const idle = renderMode("idle");
check("idle keeps the microphone and nothing else", idle.capsule === null && idle.toolbar.classes.some((name) => name.includes("dsh-vr-idle-wrap")), idle.toolbar.classes.join(" | "));

console.log("theme colours");
check("the blue accent is the business token, not the neutral brand one", /--dsw-alias-state-business-primary/.test(source) && !/dsh-vr-round-[a-z]+ \{[^}]*--dsw-alias-brand-primary/.test(source));
check("the canvas accent reads the same token", /themeColor\(canvas, '--dsw-alias-state-business-primary'/.test(source));

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
