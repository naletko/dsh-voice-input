# Voice Input for DeepSeek Harness

A feature-rich, high-performance voice recording and transcription plugin for **DeepSeek Harness (DSH)**. It places a clean microphone icon directly beside the model selector in your composer bar, allowing you to record, pause, listen back to your audio, and transcribe it into your message draft using any OpenAI-compatible API or multimodal model (such as `gemini-3.8-flash-high`).

---

## ✨ Features

- **Toolbar Integration**: Docked right beside the model selector in the composer toolbar.
- **One-Click Recording**: Click the microphone icon to begin recording audio immediately.
- **Real-time Recording Timer**: Live elapsed time counter (`MM:SS`) with a visual recording indicator.
- **Pause & Resume**: Pause recording anytime, and resume right from where you stopped.
- **Audio Playback & Review**: Listen to what you recorded before sending. Includes Play, Pause Playback, and Stop Playback controls.
- **Discard / Cancel**: Discard the recording at any stage with a single click.
- **Direct Send**: Click **Send** while recording or during review. The audio is converted to standard 16kHz mono WAV in the browser and forwarded to your configured provider.
- **Auto Draft Insertion**: Transcribed text is automatically inserted directly into your conversation draft.
- **Custom Provider & Model Settings**:
  - Easily configure your **Provider API Base URL**, **API Key**, and **Model ID** directly from the UI via the ⚙ (gear) icon.
  - Includes a Show/Hide toggle for the API key.
  - Preferences persist across sessions in local storage.

---

## 📦 What Is Included vs. What Is Not

### Included:
- **Client Web UI Module (`client.js`)**: Pure JavaScript component that mounts into the `conversation.input.activity` slot, managing recording, timers, playback, and settings modal.
- **Host Backend Service (`index.js`)**: Fast Node.js service that hosts `/api/voice-input/transcribe` and `/api/voice-input/config`, forwarding audio to your OpenAI-compatible endpoint.
- **Multi-Modal & Whisper Fallback**: Supports both OpenAI Chat Completions with `input_audio` (e.g. Gemini 3.8 / GPT-4o multimodal models) and traditional `/v1/audio/transcriptions` (Whisper endpoints).
- **Desktop Microphone Enabler Utility (`enable-desktop-mic.cjs`)**: Automates patching the DeepSeek Harness Desktop Electron app on Windows to grant media/microphone access.

### NOT Included:
- **No API Keys or Private URLs**: By default, no API keys or backend URLs are bundled. You must supply your own provider endpoint and credentials in the Settings modal.
- **No Heavy Native Dependencies**: Uses native browser Web Audio API (`AudioContext`, `MediaRecorder`) and Node.js standard built-ins (`fetch`, `Buffer`, `Blob`).

---

## 🎙 Transcription System Instruction

When transcribing speech through multimodal LLMs (e.g. `gemini-3.8-flash-high`), the backend applies this transcription directive:

> *"You are an expert transcriber and translator. Translate or transcribe the exact meaning of the audio into clean English. Remove any spoken filler words, stutters, repetitions, and hesitation marks (like 'um', 'uh', 'you know'). Do NOT add any summaries, conversational responses, or formatting. Output ONLY the raw, clean translated text."*

---

## 🛠 DeepSeek Harness Desktop App: Microphone Permission Fix

If you are using the **DSH Desktop** (Windows Electron desktop app), you might encounter:
```
Microphone access denied or unavailable: Permission denied
```

### Why This Happens:
DeepSeek Harness Desktop is an Electron application. In its main process (`out/main/index.js`), it enforces a strict permission check:
```javascript
function canGrantWindowPermission(permission, requestingUrl, isMainFrame) {
  return (permission === "clipboard-sanitized-write" || permission === "notifications") && ...
}
```
Because the `media` (microphone) permission was omitted from this whitelist, Electron automatically denies all microphone requests before Windows even sees them. Consequently, DeepSeek Desktop never prompts for microphone access and does not show up in Windows Privacy Settings.

### How to Fix It (Automated):

This repository provides an automated patch script: `enable-desktop-mic.cjs`.

1. Close **DSH Desktop**.
2. Run the patch script from your terminal:
   ```bash
   node enable-desktop-mic.cjs
   ```
   *The script automatically creates a backup (`app.asar.bak`) and patches `app.asar` to include `media` in the permission check.*
3. Ensure Windows Desktop microphone access is enabled:
   - Open Windows **Settings** (`Win + I`) → **Privacy & security** → **Microphone**.
   - Make sure **Microphone access** is **ON**.
   - Make sure **Let apps access your microphone** is **ON**.
   - Scroll to the bottom and ensure **Let desktop apps access your microphone** is **ON**.
4. Relaunch **DSH Desktop**.

---

## 🌐 Web Browser Access

You can also use DeepSeek Harness directly through any web browser (Google Chrome, Microsoft Edge, Brave, Firefox):

1. Find your local Harness port (displayed when starting DSH, typically `http://127.0.0.1:43129` or similar).
2. Open that URL in your browser.
3. Click the microphone icon — your browser will display the standard permission prompt:
   > *"127.0.0.1 wants to use your microphone: [Allow] [Block]"*
4. Click **Allow**.

---

## 🚀 Installation into DeepSeek Harness

1. Clone or copy this repository into your workspace or plugins directory:
   ```bash
   git clone https://github.com/likhonmain/voice-input.git
   ```

2. Install the bundle using the Harness Plugin Manager or CLI:
   - From DSH chat: ask the agent to install bundle `dsh-voice-input` from this folder path.
   - Or install via profile manifest.

3. Open Settings by clicking the **⚙ (gear)** icon next to the microphone icon in the composer bar:
   - **Provider API Base URL**: (e.g., `http://your-proxy-host:8000/v1`)
   - **API Key**: (e.g., `your-api-key`)
   - **Model ID**: (e.g., `gemini-3.8-flash-high`)
4. Click **Save** and start speaking!

---

## 📄 License

MIT License. Feel free to use, modify, and distribute.

---

## 🔧 Local changes in this checkout

This is a fork of [likhonmain/voice-input](https://github.com/likhonmain/voice-input)
(MIT). It carries the local modifications below on top of upstream; `git diff`
against the `upstream` remote shows exactly what changed.

1. **Provider settings moved out of the composer** (`client.js`). The gear button
   beside the microphone is gone; the same three fields now render on the
   plugin's own page in **Plugins**, registered through the `plugins.bundle.config`
   slot (key `dsh-voice-input`) and the `plugins.row.config` slot
   (key `dsh-voice-input#voice-input`). Nothing else about the recorder changed.
2. **Settings take effect without a reload** (`client.js`). The transcribe request
   reads the newest persisted provider settings instead of a copy captured when
   the recorder mounted, so saving the form is enough.
3. **Streaming speech providers are supported** (`index.js`). A base URL with a
   `ws://` or `wss://` scheme now takes a dedicated path instead of the three HTTP
   attempts: the canonical 16 kHz mono PCM16 payload of the recording is streamed
   as binary frames, followed by `{"type":"audio.done"}`, and the transcript is
   taken from the server's `transcript.done` event. This is what xAI's Grok STT
   needs, because it exposes only `wss://api.x.ai/v1/stt` and has no HTTP
   transcription endpoint (`POST /v1/audio/transcriptions` answers 404).

   Working configuration for xAI:

   - **Provider API Base URL:** `wss://api.x.ai/v1/stt`
   - **API Key:** an xAI key with speech-to-text permission
   - **Model ID:** unused by the streaming path; keep whatever the account names

   An empty transcript means the provider heard no speech; the message says so
   explicitly instead of reporting a transport failure. Frames are paced instead
   of sent as one burst, every `transcript.done` is accumulated rather than only
   the first, and the exchange ends after a quiet period so a late final result
   is kept. With `debugLog` configured, the host appends the audio format, its
   loudness, the frames sent and every provider event to that file.
4. **The recording UI is one capsule over the composer input** (`client.js`),
   modelled on the voice bar of ChatGPT: a full-width pill with an X on the
   left, a waveform in the middle and round controls on the right. The ticking
   `mm:ss` counter, the label with its pulsing dot and the wide Send/Resume
   buttons are gone. The microphone stays in the composer toolbar; everything
   else is registered in the `conversation.input.overlay` slot, which anchors to
   the composer card, carried there by a tiny store (`recorderView`) the
   recorder publishes into and the bar host (`VoiceStripHost`) subscribes to.

   While a recording exists the host adds `dsh-vr-recording` to the composer
   card, and the plugin's CSS makes that card drop its own background, border
   and shadow, so only the pill is visible and it reads as a replaced input.

   - *Recording* draws the live microphone level on a canvas driven by an
     `AnalyserNode` (routed through a muted gain node, so nothing is monitored
     audibly). Bars are 2 px wide with a 3 px gap, newest at the right edge, so
     silence shows the dotted baseline of the reference; brightness tracks
     amplitude. Controls: X discards, pause, a ringed stop ends the recording,
     the blue arrow transcribes and inserts.
   - *Paused* shows the shape recorded so far, measured by decoding the partial
     recording (`measurePeaks`).
   - *Review* shows the whole recording with a playhead; the part already played
     is drawn in the accent colour and the rest muted.
   - *Sending* clears the capsule at once: the composer comes back immediately
     and the wait shows as a small spinner beside the microphone, replaced by a
     brief check when the transcript lands. Both live in the toolbar, never over
     the input.
   - The accent colour is `--dsw-alias-state-business-primary` (the DeepSeek
     blue); `--dsw-alias-brand-primary` is a neutral in this theme and painted
     the buttons white.
   - `prefers-reduced-motion` disables the shimmer sweep and control
     transitions.

   `docs/voice-bar.html` and `docs/voice-settings.html` render the bar states and
   the settings form with mock data, for a quick look without touching DSH; the
   plugin's own `WaveStrip` and form remain the authoritative code.

Verification ships in `test/`, runs on plain Node and needs no network or
credential:

```
node test/settings-check.mjs   # slots, composer, bar structure, form styling, render
node test/stream-check.mjs     # streaming parsing, replaying the captured xAI events
node test/metadata-check.mjs   # the card's title, description and icon contract
```

## Plugin display metadata

The Plugins page shows a plugin's title and description from
`locale/<language>.json` (`meta.title`, `meta.description`) and its icon from the
`icon` field of `package.json`. Both are resolved **through the package's
`exports` map**, so `./package.json` and `./locale/*.json` have to stay exported:
without those subpaths the manager cannot read the manifest at all and the card
falls back to the bare module name with no description — even though the files
exist. Icons must be a relative path inside the package, one of SVG, PNG, JPEG or
WebP, and at most 256 KiB; `test/metadata-check.mjs` guards the whole contract.

Current metadata: title **Voice Input by Alex Naletko**, a one-line description of
what the plugin does, and `icon.svg` (a blue waveform). `locale/ru.json` carries
the Russian translation, which the UI uses when its language is Russian.

