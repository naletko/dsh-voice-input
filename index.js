// Host service for Voice Input plugin (dsh-voice-input)
import fs from 'node:fs';
import path from 'node:path';

export const inject = ['webServer'];

function getConfigFilePaths() {
  const paths = [];
  if (process.env.APPDATA) {
    paths.push(path.join(process.env.APPDATA, 'dsh-desktop', 'voice-input-config.json'));
  }
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    paths.push(path.join(home, '.dsh-voice-input-config.json'));
  }
  return paths;
}

function loadDiskConfig() {
  for (const p of getConfigFilePaths()) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (e) {}
  }
  return null;
}

function saveDiskConfig(cfg) {
  for (const p of getConfigFilePaths()) {
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
      break;
    } catch (e) {}
  }
}

/** Read the RIFF payload together with its declared format. */
function wavePayload(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Streaming transcription needs a WAV recording');
  }
  let offset = 12;
  let format = { sampleRate: 0, channels: 0, bits: 0 };
  let data;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 24 <= buffer.length) {
      format = {
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bits: buffer.readUInt16LE(offset + 22)
      };
    } else if (id === 'data') {
      data = buffer.subarray(offset + 8, Math.min(offset + 8 + size, buffer.length));
    }
    offset += 8 + size + (size % 2);
  }
  if (data === undefined) throw new Error('WAV recording has no data chunk');
  return { pcm: data, format };
}

/** Append one diagnostic line when a stream log path is configured. */
function makeNote(logPath) {
  if (typeof logPath !== 'string' || logPath.trim() === '') return () => {};
  return (line) => {
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
    } catch (e) {}
  };
}

/**
 * Stream one recording to a provider socket and resolve with its final text.
 *
 * Providers whose speech API is streaming only (xAI's `wss://api.x.ai/v1/stt`)
 * take binary 16 kHz mono PCM16 frames followed by `{"type":"audio.done"}` and
 * answer with `transcript.done`. Frames are paced rather than fired in one
 * burst, transcripts are accumulated rather than trusting the first event, and
 * the exchange only ends after a quiet period, so a late final result is kept.
 */
function transcribeOverSocket(endpoint, apiKey, wavBuffer, timeoutMs, note = () => {}) {
  if (typeof WebSocket !== 'function') {
    return Promise.reject(new Error('This runtime has no WebSocket support for streaming transcription'));
  }
  let parsed;
  try {
    parsed = wavePayload(wavBuffer);
  } catch (error) {
    return Promise.reject(error);
  }
  const { pcm, format } = parsed;

  let peak = 0;
  let energy = 0;
  const sampleCount = Math.max(1, Math.floor(pcm.length / 2));
  for (let index = 0; index + 1 < pcm.length; index += 2) {
    const sample = pcm.readInt16LE(index) / 32768;
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
    energy += sample * sample;
  }
  const bytesPerSecond = format.sampleRate * format.channels * (format.bits / 8);
  note(`audio ${pcm.length} bytes | ${format.sampleRate} Hz ${format.channels} ch ${format.bits} bit`
    + ` | ${bytesPerSecond > 0 ? (pcm.length / bytesPerSecond).toFixed(2) : '?'} s`
    + ` | rms ${Math.sqrt(energy / sampleCount).toFixed(4)} peak ${peak.toFixed(3)}`);

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, { headers: { authorization: `Bearer ${apiKey}` } });
    let settled = false;
    let timeout = null;
    let grace = null;
    let frames = 0;
    /** Best transcript seen so far; partials arrive as cumulative snapshots. */
    let best = '';

    const finish = (ok, value) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      if (grace !== null) clearTimeout(grace);
      try { socket.close(); } catch (e) {}
      note(ok ? `done: ${JSON.stringify(String(value).slice(0, 200))}` : `failed: ${value.message}`);
      if (ok) resolve(value); else reject(value);
    };
    /**
     * xAI reports the recognised speech in `transcript.partial` and then closes
     * the exchange with an empty `transcript.done`, so the longest text seen —
     * including a final event that does carry text — is the transcript.
     */
    const consider = (value) => {
      if (typeof value !== 'string') return;
      const part = value.trim();
      if (part === '') return;
      if (part.length >= best.length) best = part;
      else if (!best.includes(part)) best = `${best} ${part}`;
    };

    timeout = setTimeout(() => finish(false, new Error(`Streaming transcription timed out after ${timeoutMs} ms`)), timeoutMs);

    socket.addEventListener('open', async () => {
      note(`socket open -> ${endpoint}`);
      const frameBytes = 3200; // 100 ms of 16 kHz mono PCM16
      for (let offset = 0; offset < pcm.length; offset += frameBytes) {
        if (settled) return;
        socket.send(pcm.subarray(offset, offset + frameBytes));
        frames += 1;
        await new Promise((pause) => setTimeout(pause, 8));
      }
      if (settled) return;
      note(`sent ${frames} frames, audio.done`);
      socket.send(JSON.stringify({ type: 'audio.done' }));
      // A provider that never reports completion still settles here.
      grace = setTimeout(() => { if (best !== '') finish(true, best); }, 2500);
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        note(`<- binary ${event.data?.byteLength ?? event.data?.size ?? 0} bytes`);
        return;
      }
      note(`<- ${event.data.slice(0, 300)}`);
      let message;
      try { message = JSON.parse(event.data); } catch (e) { return; }
      if (message.type === 'transcript.partial') {
        consider(message.text);
      } else if (message.type === 'transcript.done' || message.type === 'transcript.completed') {
        consider(message.text);
        // A late partial may still follow the completion event.
        if (grace !== null) clearTimeout(grace);
        grace = setTimeout(() => finish(true, best), 400);
      } else if (message.type === 'error') {
        finish(false, new Error(message.message || JSON.stringify(message)));
      }
    });
    socket.addEventListener('error', (event) => {
      finish(false, new Error(event.message || (event.error && event.error.message) || 'streaming socket error'));
    });
    socket.addEventListener('close', (event) => {
      if (best !== '') finish(true, best);
      else finish(false, new Error(`Streaming socket closed before a transcript (code ${event.code}${event.reason ? ': ' + event.reason : ''})`));
    });
  });
}

export function apply(ctx, config) {
  const diskConfig = loadDiskConfig() || {};
  const currentConfig = {
    url: (diskConfig.url || config?.url || '').replace(/\/+$/, ''),
    apiKey: diskConfig.apiKey || config?.apiKey || '',
    model: diskConfig.model || config?.model || 'gemini-3.8-flash-high'
  };

  const parseJsonBody = (req) => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Audio payload exceeds 50MB limit'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON payload: ' + err.message));
      }
    });
    req.on('error', reject);
  });

  const sendJson = (res, statusCode, data) => {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(json);
  };

  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: '/api/voice-input',
      handler: async (req, res) => {
        try {
          const urlObj = new URL(req.url, 'http://127.0.0.1');
          const pathname = urlObj.pathname;

          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            });
            res.end();
            return;
          }

          // Configuration endpoints
          if (pathname === '/api/voice-input/config' || pathname === '/api/voice-recorder/config') {
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, config: currentConfig });
              return;
            }
            if (req.method === 'POST') {
              const body = await parseJsonBody(req);
              if (body.url !== undefined) currentConfig.url = String(body.url).trim().replace(/\/+$/, '');
              if (body.apiKey !== undefined) currentConfig.apiKey = String(body.apiKey).trim();
              if (body.model !== undefined) currentConfig.model = String(body.model).trim();
              saveDiskConfig(currentConfig);
              sendJson(res, 200, { ok: true, config: currentConfig });
              return;
            }
          }

          // Audio Transcription endpoint
          if ((pathname === '/api/voice-input/transcribe' || pathname === '/api/voice-recorder/transcribe') && req.method === 'POST') {
            const body = await parseJsonBody(req);
            const { audioBase64, format = 'wav' } = body;

            if (!audioBase64) {
              sendJson(res, 400, { ok: false, error: 'audioBase64 is required' });
              return;
            }

            const targetUrl = (body.url || currentConfig.url || '').replace(/\/+$/, '');
            const apiKey = body.apiKey || currentConfig.apiKey || '';
            const model = body.model || currentConfig.model || 'gemini-3.8-flash-high';

            if (!targetUrl) {
              sendJson(res, 400, {
                ok: false,
                error: 'Provider API URL is not set. Please click the ⚙ (gear) icon to configure your Custom Provider URL.'
              });
              return;
            }

            if (!apiKey) {
              sendJson(res, 400, {
                ok: false,
                error: 'API Key is not set. Please click the ⚙ (gear) icon to enter your API Key.'
              });
              return;
            }

            const audioBuffer = Buffer.from(audioBase64, 'base64');

            // Streaming-only providers (xAI Grok STT) have no HTTP transcription
            // endpoint: base URL carries a ws:// or wss:// scheme.
            if (/^wss?:\/\//i.test(targetUrl)) {
              const note = makeNote(config?.debugLog || diskConfig.debugLog);
              note(`--- transcribe ${audioBuffer.length} bytes -> ${targetUrl} (model ${model})`);
              try {
                const text = await transcribeOverSocket(targetUrl, apiKey, audioBuffer, 60000, note);
                if (text) {
                  sendJson(res, 200, { ok: true, text });
                } else {
                  sendJson(res, 502, { ok: false, error: 'No speech was recognised in the recording (the provider returned an empty transcript)' });
                }
              } catch (streamError) {
                sendJson(res, 502, { ok: false, error: 'Streaming transcription failed: ' + (streamError.message || String(streamError)) });
              }
              return;
            }

            let transcribedText = '';
            const errors = [];
            const systemPrompt = "You are an expert transcriber and translator. Translate or transcribe the exact meaning of the audio into clean English. Remove any spoken filler words, stutters, repetitions, and hesitation marks (like 'um', 'uh', 'you know'). Do NOT add any summaries, conversational responses, or formatting. Output ONLY the raw, clean translated text.";

            // Attempt 1: Chat Completions with input_audio (for Gemini and OpenAI multimodal LLMs)
            try {
              const chatPayload = {
                model: model,
                messages: [
                  {
                    role: 'system',
                    content: systemPrompt
                  },
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: systemPrompt
                      },
                      {
                        type: 'input_audio',
                        input_audio: {
                          data: audioBase64,
                          format: format === 'webm' ? 'wav' : (format || 'wav')
                        }
                      }
                    ]
                  }
                ],
                temperature: 0.1
              };

              const response = await fetch(`${targetUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(chatPayload),
                signal: AbortSignal.timeout(60000)
              });

              if (response.ok) {
                const data = await response.json();
                const content = data.choices?.[0]?.message?.content;
                if (content && typeof content === 'string' && content.trim()) {
                  transcribedText = content.trim();
                }
              } else {
                const errText = await response.text();
                errors.push(`chat/completions input_audio (HTTP ${response.status}): ${errText.slice(0, 300)}`);
              }
            } catch (err) {
              errors.push(`chat/completions input_audio error: ${err.message}`);
            }

            // Attempt 2: Standard OpenAI Audio Transcriptions API (Whisper endpoints)
            if (!transcribedText) {
              try {
                const formData = new FormData();
                const mimeType = format === 'webm' ? 'audio/webm' : 'audio/wav';
                const audioBlob = new Blob([audioBuffer], { type: mimeType });
                formData.append('file', audioBlob, `audio.${format || 'wav'}`);
                formData.append('model', model);

                const response = await fetch(`${targetUrl}/audio/transcriptions`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`
                  },
                  body: formData,
                  signal: AbortSignal.timeout(60000)
                });

                if (response.ok) {
                  const data = await response.json();
                  if (data && typeof data.text === 'string' && data.text.trim()) {
                    transcribedText = data.text.trim();
                  }
                } else {
                  const errText = await response.text();
                  errors.push(`audio/transcriptions (HTTP ${response.status}): ${errText.slice(0, 300)}`);
                }
              } catch (err) {
                errors.push(`audio/transcriptions request error: ${err.message}`);
              }
            }

            // Attempt 3: Chat Completions with data URI in image_url (fallback format for some proxy servers)
            if (!transcribedText) {
              try {
                const mimeType = format === 'webm' ? 'audio/webm' : 'audio/wav';
                const chatPayload = {
                  model: model,
                  messages: [
                    {
                      role: 'system',
                      content: systemPrompt
                    },
                    {
                      role: 'user',
                      content: [
                        {
                          type: 'text',
                          text: systemPrompt
                        },
                        {
                          type: 'image_url',
                          image_url: {
                            url: `data:${mimeType};base64,${audioBase64}`
                          }
                        }
                      ]
                    }
                  ],
                  temperature: 0.1
                };

                const response = await fetch(`${targetUrl}/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(chatPayload),
                  signal: AbortSignal.timeout(60000)
                });

                if (response.ok) {
                  const data = await response.json();
                  const content = data.choices?.[0]?.message?.content;
                  if (content && typeof content === 'string' && content.trim()) {
                    transcribedText = content.trim();
                  }
                } else {
                  const errText = await response.text();
                  errors.push(`chat/completions data_uri (HTTP ${response.status}): ${errText.slice(0, 300)}`);
                }
              } catch (err) {
                errors.push(`chat/completions data_uri error: ${err.message}`);
              }
            }

            if (transcribedText) {
              sendJson(res, 200, { ok: true, text: transcribedText });
            } else {
              sendJson(res, 502, {
                ok: false,
                error: errors.join('; ') || 'Transcription failed across all attempts'
              });
            }
            return;
          }

          sendJson(res, 404, { ok: false, error: 'Route not found' });
        } catch (fatalError) {
          sendJson(res, 500, { ok: false, error: fatalError.message || String(fatalError) });
        }
      }
    });
  });
}
