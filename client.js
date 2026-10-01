window.__ModuleLoader__.load({
  id: 'dsh-voice-input',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect, useRef, useCallback } = React;

    // One line, so a stale bundle in the browser is obvious from the console.
    console.info('[dsh-voice-input] client bundle loaded · capsule bar, styled settings, own stylesheet');

    const DEFAULT_CONFIG = {
      url: '',
      apiKey: '',
      model: 'gemini-3.8-flash-high'
    };

    const STORAGE_KEY = 'dsh_voice_input_config';

    function loadSavedConfig() {
      try {
        const item = window.localStorage.getItem(STORAGE_KEY);
        if (item) {
          const parsed = JSON.parse(item);
          return {
            url: parsed.url || DEFAULT_CONFIG.url,
            apiKey: parsed.apiKey || DEFAULT_CONFIG.apiKey,
            model: parsed.model || DEFAULT_CONFIG.model
          };
        }
      } catch (e) {}
      return { ...DEFAULT_CONFIG };
    }

    function saveConfig(cfg) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch (e) {}
    }

    function formatTime(seconds) {
      const s = Math.max(0, Math.floor(seconds));
      const mins = Math.floor(s / 60);
      const secs = s % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    async function convertToWavBlob(blob) {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return blob;
        const tempCtx = new AudioCtx();
        const decoded = await tempCtx.decodeAudioData(arrayBuffer);
        await tempCtx.close().catch(() => {});

        const targetRate = 16000;
        const duration = decoded.duration;
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offlineCtx = new OfflineCtx(1, Math.max(1, Math.ceil(duration * targetRate)), targetRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(offlineCtx.destination);
        source.start(0);
        const resampled = await offlineCtx.startRendering();

        const channelData = resampled.getChannelData(0);
        const wavBuffer = new ArrayBuffer(44 + channelData.length * 2);
        const view = new DataView(wavBuffer);

        function writeStr(offset, str) {
          for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        }

        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + channelData.length * 2, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, targetRate, true);
        view.setUint32(28, targetRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true); // 16-bit
        writeStr(36, 'data');
        view.setUint32(40, channelData.length * 2, true);

        let offset = 44;
        for (let i = 0; i < channelData.length; i++, offset += 2) {
          const sample = Math.max(-1, Math.min(1, channelData[i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
        return new Blob([wavBuffer], { type: 'audio/wav' });
      } catch (e) {
        console.warn('[voice-recorder] WAV conversion fallback', e);
        return blob;
      }
    }

    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result;
          if (typeof res === 'string') {
            resolve(res.split(',')[1] || '');
          } else {
            resolve('');
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    // SVG icons
    function IconMic() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('path', { d: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' }),
        h('path', { d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
        h('line', { x1: 12, y1: 19, x2: 12, y2: 23 }),
        h('line', { x1: 8, y1: 23, x2: 16, y2: 23 })
      );
    }

    function IconPause() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'currentColor'
      },
        h('rect', { x: 5, y: 4, width: 4, height: 16, rx: 1 }),
        h('rect', { x: 15, y: 4, width: 4, height: 16, rx: 1 })
      );
    }

    function IconPlay() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'currentColor'
      },
        h('polygon', { points: '6 3 20 12 6 21 6 3' })
      );
    }

    function IconStop() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'currentColor'
      },
        h('rect', { x: 5, y: 5, width: 14, height: 14, rx: 2 })
      );
    }

    function IconSend() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('line', { x1: 22, y1: 2, x2: 11, y2: 13 }),
        h('polygon', { points: '22 2 15 22 11 13 2 9 22 2' })
      );
    }

    function IconClose() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 14, height: 14,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        h('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
      );
    }

    /** Upward arrow: the send control of a voice bar. */
    function IconArrowUp() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2.4,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('line', { x1: 12, y1: 19, x2: 12, y2: 6 }),
        h('polyline', { points: '6 12 12 6 18 12' })
      );
    }

    /** A check for the moment a transcript lands in the draft. */
    function IconCheck() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 15, height: 15,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2.6,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('polyline', { points: '20 6 9 17 4 12' })
      );
    }

    function IconGear() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13,
        fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      },
        h('circle', { cx: 12, cy: 12, r: 3 }),
        h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' })
      );
    }

    const STYLES = `
      .dsh-vr-container {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        font-family: inherit;
        user-select: none;
      }
      .dsh-vr-idle-wrap {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .dsh-vr-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        min-width: 28px;
        padding: 0 6px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #888);
        cursor: pointer;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
        box-sizing: border-box;
      }
      .dsh-vr-btn:hover {
        background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15));
        color: var(--dsw-alias-label-primary, #eee);
      }
      .dsh-vr-btn:active {
        opacity: 0.8;
      }
      .dsh-vr-btn-send {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 28px !important;
        padding: 0 12px !important;
        background-color: #2563eb !important;
        background: #2563eb !important;
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border: 1px solid #1d4ed8 !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        gap: 5px !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25) !important;
      }
      .dsh-vr-btn-send:hover {
        background-color: #1d4ed8 !important;
        background: #1d4ed8 !important;
        border-color: #60a5fa !important;
      }
      .dsh-vr-btn-send svg {
        stroke: #ffffff !important;
        color: #ffffff !important;
        fill: none !important;
      }
      .dsh-vr-btn-send span {
        color: #ffffff !important;
        font-weight: 600 !important;
      }
      .dsh-vr-btn-resume {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 28px !important;
        padding: 0 10px !important;
        background-color: #2563eb !important;
        background: #2563eb !important;
        color: #ffffff !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        border: 1px solid #1d4ed8 !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        gap: 4px !important;
      }
      .dsh-vr-btn-resume:hover {
        background-color: #1d4ed8 !important;
        background: #1d4ed8 !important;
      }
      .dsh-vr-btn-resume svg {
        fill: #ffffff !important;
        color: #ffffff !important;
      }
      .dsh-vr-btn-resume span {
        color: #ffffff !important;
      }
      .dsh-vr-btn-primary {
        background: #2563eb !important;
        color: #fff !important;
        font-weight: 500;
        gap: 4px;
        padding: 0 10px;
        border-radius: 6px;
      }
      .dsh-vr-btn-primary:hover {
        background: #1d4ed8 !important;
      }
      .dsh-vr-btn-danger {
        color: var(--dsw-alias-state-error-primary, #f56c6c);
      }
      .dsh-vr-btn-danger:hover {
        background: rgba(245, 108, 108, 0.15);
      }
      .dsh-vr-btn-warning {
        color: var(--dsw-alias-state-warn-primary, #e6a23c);
      }
      .dsh-vr-btn-warning:hover {
        background: rgba(230, 162, 60, 0.15);
      }
      .dsh-vr-active-bar {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--dsw-alias-bg-layer-1, #252528);
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
        padding: 3px 8px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      /* ── The voice strip: one quiet bar instead of a row of controls ───── */
      .dsh-vr-strip {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        max-width: 620px;
        height: 36px;
        padding: 0 6px 0 10px;
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1, #252528);
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18);
      }
      .dsh-vr-strip-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary, #a9a9b0);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .dsh-vr-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--dsw-alias-brand-primary, #2080f0);
        flex-shrink: 0;
      }
      .dsh-vr-dot-live {
        background: var(--dsw-alias-state-error-primary, #f56c6c);
        animation: dsh-vr-breathe 1.6s ease-in-out infinite;
      }
      .dsh-vr-dot-paused { background: var(--dsw-alias-state-warn-primary, #e6a23c); }
      .dsh-vr-dot-ok { background: var(--dsw-alias-state-success-primary, #67c23a); }
      @keyframes dsh-vr-breathe {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.35; transform: scale(0.82); }
      }
      .dsh-vr-wave {
        flex: 1 1 auto;
        min-width: 0;
        height: 24px;
        display: block;
      }
      .dsh-vr-strip-actions {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
      }
      .dsh-vr-strip-time {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary, #7d7d85);
        min-width: 64px;
        text-align: right;
        flex-shrink: 0;
      }
      .dsh-vr-ghost {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #a9a9b0);
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease;
      }
      .dsh-vr-ghost:hover {
        background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.07));
        color: var(--dsw-alias-label-primary, #eee);
      }
      .dsh-vr-ghost-primary { color: var(--dsw-alias-brand-primary, #2080f0); }
      .dsh-vr-ghost-danger:hover { color: var(--dsw-alias-state-error-primary, #f56c6c); }
      @media (prefers-reduced-motion: reduce) {
        .dsh-vr-dot-live { animation: none; }
      }

      /* ── The voice bar: one capsule over the input while recording ─────── */
      .dsh-vr-bar {
        position: absolute;
        left: 8px;
        right: 8px;
        top: 4px;
        height: 44px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 6px 0 6px;
        box-sizing: border-box;
        border-radius: 22px;
        background: var(--dsw-alias-bg-layer-2, #2b2b30);
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
        z-index: 8;
      }
      /* While a recording exists the capsule is the composer: the card behind it
         stops drawing its own field, so only the pill is visible. */
      [data-composer-card].dsh-vr-recording {
        background: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }
      .dsh-vr-bar-wave {
        flex: 1 1 auto;
        min-width: 0;
        height: 26px;
        display: block;
      }
      .dsh-vr-bar-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      .dsh-vr-round {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid transparent;
        background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.09));
        color: var(--dsw-alias-label-primary, #f2f2f4);
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
      }
      .dsh-vr-round:hover {
        background: var(--dsw-alias-bg-layer-4, rgba(255, 255, 255, 0.16));
      }
      .dsh-vr-round-quiet {
        background: transparent;
        border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
        color: var(--dsw-alias-label-primary, #eaeaee);
      }
      .dsh-vr-round-stop {
        background: transparent;
        border: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
        color: var(--dsw-alias-label-primary, #ffffff);
      }
      .dsh-vr-round-send {
        background: var(--dsw-alias-state-business-primary, #4176e6);
        border-color: var(--dsw-alias-state-business-primary, #4176e6);
        color: #ffffff;
      }
      .dsh-vr-round-send:hover {
        filter: brightness(1.12);
        background: var(--dsw-alias-state-business-primary, #4176e6);
      }
      /* Feedback that stays beside the microphone instead of covering the input. */
      .dsh-vr-check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        color: var(--dsw-alias-state-success-primary, #67c23a);
      }

      /* ── Settings form on the plugin page, in the product's own style ──── */
      .dsh-vr-form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-width: 460px;
        padding: 2px 0 6px;
      }
      .dsh-vr-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dsh-vr-field-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .dsh-vr-field-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--dsw-alias-label-secondary, #a9a9b0);
      }
      .dsh-vr-field-input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        color: var(--dsw-alias-label-primary, #ececf1);
        background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
        border-radius: 8px;
        outline: none;
        transition: border-color 120ms ease, box-shadow 120ms ease;
      }
      .dsh-vr-field-input::placeholder {
        color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.3));
      }
      .dsh-vr-field-input:hover {
        border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
      }
      .dsh-vr-field-input:focus {
        border-color: var(--dsw-alias-state-business-primary, #4176e6);
        box-shadow: 0 0 0 3px rgba(65, 118, 230, 0.16);
      }
      .dsh-vr-link {
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        font-size: 11px;
        color: var(--dsw-alias-state-business-primary, #4176e6);
        cursor: pointer;
      }
      .dsh-vr-link:hover {
        text-decoration: underline;
      }
      .dsh-vr-form-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 2px;
      }
      .dsh-vr-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 30px;
        padding: 0 14px;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
        background: transparent;
        color: var(--dsw-alias-label-primary, #ececf1);
        cursor: pointer;
        transition: background 120ms ease, filter 120ms ease, border-color 120ms ease;
      }
      .dsh-vr-action:hover {
        background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.08));
      }
      .dsh-vr-action-primary {
        background: var(--dsw-alias-state-business-primary, #4176e6);
        border-color: var(--dsw-alias-state-business-primary, #4176e6);
        color: #ffffff;
      }
      .dsh-vr-action-primary:hover {
        filter: brightness(1.1);
        background: var(--dsw-alias-state-business-primary, #4176e6);
      }
      .dsh-vr-form-status {
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.4));
      }
      .dsh-vr-form-hint {
        font-size: 11px;
        line-height: 1.5;
        color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.4));
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-vr-round { transition: none; }
        .dsh-vr-field-input, .dsh-vr-action { transition: none; }
      }
      .dsh-vr-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--dsw-alias-state-error-primary, #f56c6c);
        animation: dsh-vr-pulse 1.2s infinite ease-in-out;
        flex-shrink: 0;
      }
      .dsh-vr-indicator-paused {
        background: var(--dsw-alias-state-warn-primary, #e6a23c);
        animation: none;
      }
      .dsh-vr-indicator-playback {
        background: var(--dsw-alias-brand-primary, #2080f0);
        animation: none;
      }
      @keyframes dsh-vr-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.3; transform: scale(0.85); }
      }
      .dsh-vr-timer {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary, #eee);
        min-width: 44px;
        text-align: center;
      }
      .dsh-vr-status-text {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary, #aaa);
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-vr-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
        border-top-color: var(--dsw-alias-brand-primary, #2080f0);
        border-radius: 50%;
        animation: dsh-vr-spin 0.8s linear infinite;
        flex-shrink: 0;
      }
      @keyframes dsh-vr-spin {
        to { transform: rotate(360deg); }
      }

      /* Modal Dialog Backdrop & Card */
      .dsh-vr-modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(2px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dsh-vr-modal-card {
        width: 440px;
        max-width: 90vw;
        background: var(--dsw-alias-bg-overlay, #1e1e20);
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.15));
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
        padding: 22px;
        color: var(--dsw-alias-label-primary, #eee);
        box-sizing: border-box;
      }
      .dsh-vr-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 18px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
      }
      .dsh-vr-modal-title {
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--dsw-alias-label-primary, #eee);
      }
      .dsh-vr-modal-close-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary, #888);
        cursor: pointer;
      }
      .dsh-vr-modal-close-btn:hover {
        background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.1));
        color: var(--dsw-alias-label-primary, #fff);
      }
      .dsh-vr-form-group {
        margin-bottom: 14px;
      }
      .dsh-vr-label {
        display: block;
        font-size: 12px;
        font-weight: 500;
        color: var(--dsw-alias-label-secondary, #aaa);
        margin-bottom: 6px;
      }
      .dsh-vr-input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        font-size: 13px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.15));
        background: var(--dsw-alias-bg-layer-2, #2a2a2e);
        color: var(--dsw-alias-label-primary, #eee);
        outline: none;
      }
      .dsh-vr-input:focus {
        border-color: var(--dsw-alias-brand-primary, #2080f0);
      }
      .dsh-vr-modal-footer {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        margin-top: 20px;
        padding-top: 14px;
        border-top: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.1));
      }
      .dsh-vr-modal-btn {
        padding: 6px 14px;
        font-size: 13px;
        border-radius: 6px;
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.15));
        background: var(--dsw-alias-bg-layer-2, #333);
        color: var(--dsw-alias-label-primary, #eee);
        cursor: pointer;
        transition: background 0.15s;
      }
      .dsh-vr-modal-btn:hover {
        filter: brightness(1.15);
      }
      .dsh-vr-modal-btn-save {
        background: var(--dsw-alias-brand-primary, #2080f0);
        border-color: var(--dsw-alias-brand-primary, #2080f0);
        color: #fff;
        font-weight: 500;
      }

      /* Floating Error Toast */
      .dsh-vr-error-toast {
        position: fixed;
        bottom: 85px;
        right: 24px;
        width: 380px;
        max-width: 90vw;
        background: var(--dsw-alias-bg-overlay, #1e1e20);
        border: 1px solid var(--dsw-alias-state-error-primary, #f56c6c);
        color: var(--dsw-alias-label-primary, #eee);
        padding: 14px 16px;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        z-index: 10000;
        box-sizing: border-box;
      }
      .dsh-vr-error-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .dsh-vr-error-title {
        font-weight: 600;
        font-size: 13px;
        color: var(--dsw-alias-state-error-primary, #f56c6c);
      }
      .dsh-vr-error-body {
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary, #ccc);
      }
      .dsh-vr-error-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 10px;
      }
    `;

    /**
     * Provider settings for the plugin's own page in Plugins.
     *
     * The same three fields the old composer dialog carried, moved out of the
     * toolbar: the microphone stays the only control beside the model selector.
     * Values are persisted to the host (which owns the file on disk) and to
     * local storage, so a running recorder picks them up on its next request.
     */
    function VoiceProviderSettings() {
      const [draft, setDraft] = useState(loadSavedConfig);
      const [showApiKey, setShowApiKey] = useState(false);
      const [status, setStatus] = useState('');

      useEffect(() => {
        let cancelled = false;
        fetch('/api/voice-input/config')
          .then(res => res.json())
          .then(data => {
            if (cancelled || !data || !data.ok || !data.config) return;
            const merged = {
              url: data.config.url || '',
              apiKey: data.config.apiKey || '',
              model: data.config.model || DEFAULT_CONFIG.model
            };
            setDraft(merged);
            saveConfig(merged);
          })
          .catch(() => {});
        return () => { cancelled = true; };
      }, []);

      const save = () => {
        const next = {
          url: String(draft.url || '').trim().replace(/\/+$/, ''),
          apiKey: String(draft.apiKey || '').trim(),
          model: String(draft.model || '').trim() || DEFAULT_CONFIG.model
        };
        setDraft(next);
        saveConfig(next);
        setStatus('Saving...');
        fetch('/api/voice-input/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next)
        })
          .then(res => res.json())
          .then(data => {
            if (data && data.ok && data.config) {
              setDraft(data.config);
              saveConfig(data.config);
            }
            setStatus('Saved');
          })
          .catch(err => setStatus('Save failed: ' + (err && err.message ? err.message : String(err))));
      };

      return h('div', { className: 'dsh-vr-form' },
        // The form carries its own styles: it renders on the plugin page, which
        // must not depend on the composer's microphone being mounted.
        h('style', null, STYLES),
        h('div', { className: 'dsh-vr-field' },
          h('label', { className: 'dsh-vr-field-label' }, 'Provider API Base URL'),
          h('input', {
            className: 'dsh-vr-field-input',
            type: 'text',
            spellCheck: false,
            value: draft.url,
            placeholder: 'https://api.x.ai/v1',
            onChange: (e) => setDraft({ ...draft, url: e.target.value })
          })
        ),
        h('div', { className: 'dsh-vr-field' },
          h('div', { className: 'dsh-vr-field-head' },
            h('label', { className: 'dsh-vr-field-label' }, 'API Key'),
            h('button', {
              type: 'button',
              className: 'dsh-vr-link',
              onClick: () => setShowApiKey(!showApiKey)
            }, showApiKey ? 'Hide' : 'Show')
          ),
          h('input', {
            className: 'dsh-vr-field-input',
            type: showApiKey ? 'text' : 'password',
            spellCheck: false,
            autoComplete: 'off',
            value: draft.apiKey,
            placeholder: 'your-api-key',
            onChange: (e) => setDraft({ ...draft, apiKey: e.target.value })
          })
        ),
        h('div', { className: 'dsh-vr-field' },
          h('label', { className: 'dsh-vr-field-label' }, 'Model ID'),
          h('input', {
            className: 'dsh-vr-field-input',
            type: 'text',
            spellCheck: false,
            value: draft.model,
            placeholder: 'grok-stt',
            onChange: (e) => setDraft({ ...draft, model: e.target.value })
          })
        ),
        h('div', { className: 'dsh-vr-form-actions' },
          h('button', { className: 'dsh-vr-action dsh-vr-action-primary', onClick: save }, 'Save'),
          h('button', { className: 'dsh-vr-action', onClick: () => setDraft({ ...DEFAULT_CONFIG }) }, 'Reset Defaults'),
          status && h('span', { className: 'dsh-vr-form-status' }, status)
        ),
        h('div', { className: 'dsh-vr-form-hint' },
          'xAI streams speech: use wss://api.x.ai/v1/stt and leave the model as is — it is ignored on that endpoint. '
          + 'Any OpenAI-compatible HTTP endpoint works too, then the model is sent as the transcription model.'
        )
      );
    }

    /** Slot renderer for the plugin page: a one-liner on the card, the form on the page. */
    function VoiceProviderSettingsSlot({ view }) {
      if (view === 'summary') return 'Provider URL, API key and model';
      return h(VoiceProviderSettings);
    }

    /** Resolve a theme token for the 2D canvas, with a usable fallback. */
    function themeColor(element, name, fallback) {
      try {
        const value = window.getComputedStyle(element).getPropertyValue(name).trim();
        return value || fallback;
      } catch (e) {
        return fallback;
      }
    }

    /**
     * The recording strip: one slim bar whose wave follows the microphone while
     * recording, redraws the recorded shape with a playhead while reviewing, and
     * shimmers while a transcript is on its way. Bars are drawn on a canvas so
     * they stay crisp at any width and density.
     */
    function WaveStrip({ tone = 'live', analyserRef, peaks, progress = 0, shimmer = false, leading, actions = [] }) {
      const canvasRef = useRef(null);

      useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof canvas.getContext !== 'function') return;
        const context = canvas.getContext('2d');
        const analyser = analyserRef && analyserRef.current ? analyserRef.current : null;
        const live = tone === 'live' && analyser !== null;
        const reduced = typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const levels = [];
        const samples = live ? new Uint8Array(analyser.fftSize) : null;
        let smoothed = 0;
        let frame = 0;
        let width = 0;
        let height = 0;
        let ink = '#e8e8ea';
        let accent = '#2080f0';
        let dim = 'rgba(255,255,255,0.32)';

        const paint = (now) => {
          const cssWidth = canvas.clientWidth || 0;
          const cssHeight = canvas.clientHeight || 0;
          if (cssWidth <= 0 || cssHeight <= 0) return;
          const ratio = window.devicePixelRatio || 1;
          if (cssWidth !== width || cssHeight !== height) {
            width = cssWidth;
            height = cssHeight;
            canvas.width = Math.round(cssWidth * ratio);
            canvas.height = Math.round(cssHeight * ratio);
            ink = themeColor(canvas, '--dsw-alias-label-primary', '#e8e8ea');
            // `brand-primary` is a neutral in this theme; the blue accent is the
            // business/DeepSeek one.
            accent = themeColor(canvas, '--dsw-alias-state-business-primary', '#4176e6');
            dim = themeColor(canvas, '--dsw-alias-label-tertiary', 'rgba(255,255,255,0.32)');
          }
          context.setTransform(ratio, 0, 0, ratio, 0, 0);
          context.clearRect(0, 0, width, height);

          const barWidth = 2;
          const gap = 3;
          const count = Math.max(8, Math.floor((width + gap) / (barWidth + gap)));
          const values = new Array(count);

          if (live) {
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (let index = 0; index < samples.length; index++) {
              const sample = (samples[index] - 128) / 128;
              sum += sample * sample;
            }
            const rms = Math.sqrt(sum / samples.length);
            const level = Math.min(1, Math.pow(rms * 3.4, 0.62));
            smoothed = Math.max(level, smoothed * 0.88);
            levels.push(smoothed);
            while (levels.length > count) levels.shift();
            for (let index = 0; index < count; index++) {
              values[index] = levels[levels.length - count + index] || 0;
            }
          } else if (shimmer) {
            for (let index = 0; index < count; index++) {
              const wave = reduced
                ? 0.4
                : 0.28 + 0.18 * Math.sin(index * 0.32 + now / 240) + 0.1 * Math.sin(index * 0.11 - now / 640);
              values[index] = Math.max(0.1, wave);
            }
          } else if (Array.isArray(peaks) && peaks.length > 0) {
            for (let index = 0; index < count; index++) {
              values[index] = peaks[Math.min(peaks.length - 1, Math.floor((index / count) * peaks.length))] || 0;
            }
          } else {
            for (let index = 0; index < count; index++) values[index] = 0.12;
          }

          for (let index = 0; index < count; index++) {
            const value = Math.max(0.06, Math.min(1, values[index]));
            const barHeight = Math.max(barWidth, value * (height - 6));
            const x = index * (barWidth + gap);
            const y = (height - barHeight) / 2;
            const played = !live && !shimmer && index / count <= progress;
            if (live) {
              context.globalAlpha = 0.3 + 0.55 * value;
              context.fillStyle = ink;
            } else if (shimmer) {
              context.globalAlpha = 0.35 + 0.45 * value;
              context.fillStyle = accent;
            } else {
              context.globalAlpha = played ? 0.9 : 0.35;
              context.fillStyle = played ? accent : dim;
            }
            context.beginPath();
            if (typeof context.roundRect === 'function') context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
            else context.rect(x, y, barWidth, barHeight);
            context.fill();
          }
          context.globalAlpha = 1;

          if (!live && !shimmer && progress > 0 && progress < 1) {
            const x = Math.round(progress * width) + 0.5;
            context.globalAlpha = 0.9;
            context.strokeStyle = accent;
            context.beginPath();
            context.moveTo(x, 2);
            context.lineTo(x, height - 2);
            context.stroke();
            context.globalAlpha = 1;
          }
        };

        const animate = () => {
          paint(performance.now());
          frame = window.requestAnimationFrame(animate);
        };

        if ((live || shimmer) && !reduced) frame = window.requestAnimationFrame(animate);
        else paint(performance.now());
        return () => { if (frame) window.cancelAnimationFrame(frame); };
      }, [tone, shimmer, peaks, progress, analyserRef]);

      return h('div', { className: 'dsh-vr-bar' },
        h('style', null, STYLES),
        leading ? h('button', {
          className: 'dsh-vr-round' + (leading.kind ? ' dsh-vr-round-' + leading.kind : ''),
          title: leading.title,
          'aria-label': leading.title,
          onClick: leading.onClick
        }, h(leading.icon)) : null,
        h('canvas', { ref: canvasRef, className: 'dsh-vr-bar-wave' }),
        actions.length > 0 && h('span', { className: 'dsh-vr-bar-actions' },
          ...actions.map((action, index) => h('button', {
            key: index,
            className: 'dsh-vr-round' + (action.kind ? ' dsh-vr-round-' + action.kind : ''),
            title: action.title,
            'aria-label': action.title,
            onClick: action.onClick
          }, h(action.icon)))
        )
      );
    }

    /**
     * The recorder owns the microphone, but the microphone button and the
     * recording strip live in two different composer slots. One tiny store
     * carries the recorder's view state to whichever slot renders the strip, so
     * the strip can sit in the composer dock instead of beside the Send button.
     */
    const recorderView = {
      state: null,
      listeners: new Set(),
      publish(state) {
        this.state = state;
        for (const listener of this.listeners) listener();
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
    };

    /** Read the current recorder view, re-rendering when the recorder publishes. */
    function useRecorderView() {
      const [state, setState] = useState(recorderView.state);
      useEffect(() => recorderView.subscribe(() => setState(recorderView.state)), []);
      return state;
    }

    /** The capsule itself, drawn over the composer input while a recording exists. */
    function VoiceStripHost() {
      const view = useRecorderView();
      // The capsule exists only while there is audio to shape, listen to or
      // discard. Sending and its confirmation belong to the microphone button.
      const active = view !== null && view !== undefined
        && (view.mode === 'recording' || view.mode === 'recording_paused' || view.mode === 'review');

      // Let the capsule stand alone: the composer card drops its own field while
      // a recording exists, exactly like a voice bar replacing the input.
      useEffect(() => {
        const card = typeof document === 'undefined' ? null : document.querySelector('[data-composer-card]');
        if (card === null) return;
        if (active) card.classList.add('dsh-vr-recording');
        else card.classList.remove('dsh-vr-recording');
        return () => card.classList.remove('dsh-vr-recording');
      }, [active]);

      if (!active) return null;
      const { mode, peaks, analyserRef, playbackState, playbackCurrentTime, recordSeconds, statusMsg } = view;

      const discard = { icon: IconClose, title: 'Discard recording', onClick: view.cleanupAll };
      const send = { icon: IconArrowUp, title: 'Transcribe and insert', onClick: view.sendRecording, kind: 'send' };

      if (mode === 'recording') {
        return h(WaveStrip, {
          tone: 'live',
          analyserRef,
          leading: discard,
          actions: [
            { icon: IconPause, title: 'Pause recording', onClick: view.pauseRecording, kind: 'quiet' },
            { icon: IconStop, title: 'Finish and review', onClick: view.stopRecordingToReview, kind: 'stop' },
            send
          ]
        });
      }
      if (mode === 'recording_paused') {
        return h(WaveStrip, {
          tone: 'paused',
          peaks,
          progress: 1,
          leading: discard,
          actions: [
            { icon: IconPlay, title: 'Resume recording', onClick: view.resumeRecording, kind: 'quiet' },
            { icon: IconStop, title: 'Finish and review', onClick: view.stopRecordingToReview, kind: 'stop' },
            send
          ]
        });
      }
      if (mode === 'review') {
        return h(WaveStrip, {
          tone: 'idle',
          peaks,
          progress: recordSeconds > 0 ? Math.min(1, playbackCurrentTime / recordSeconds) : 0,
          leading: discard,
          actions: [
            playbackState === 'playing'
              ? { icon: IconPause, title: 'Pause playback', onClick: view.pauseAudio, kind: 'quiet' }
              : { icon: IconPlay, title: 'Play recording', onClick: view.playAudio, kind: 'quiet' },
            send
          ]
        });
      }
      if (mode === 'sending' || mode === 'success') {
        // The audio is on its way or already inserted: the composer comes back
        // at once and the feedback moves next to the microphone.
        return null;
      }
      return null;
    }

    function VoiceRecorder({ onActiveChange, inputActions, sessionId }) {
      const [config, setConfig] = useState(loadSavedConfig);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [showApiKey, setShowApiKey] = useState(false);
      const [tempConfig, setTempConfig] = useState(config);

      // Status: 'idle' | 'recording' | 'recording_paused' | 'review' | 'sending' | 'success'
      const [mode, setMode] = useState('idle');
      const [recordSeconds, setRecordSeconds] = useState(0);

      // Playback
      const [playbackState, setPlaybackState] = useState('stopped'); // 'stopped' | 'playing' | 'paused'
      const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
      const [audioBlob, setAudioBlob] = useState(null);
      const [audioUrl, setAudioUrl] = useState(null);

      const [statusMsg, setStatusMsg] = useState('');
      const [errorMsg, setErrorMsg] = useState('');
      const [isPermissionError, setIsPermissionError] = useState(false);

      // Recorded shape for the review wave, and the live microphone analyser.
      const [peaks, setPeaks] = useState(null);
      const analyserRef = useRef(null);
      const audioContextRef = useRef(null);

      const mediaRecorderRef = useRef(null);
      const mediaStreamRef = useRef(null);
      const recordedChunksRef = useRef([]);
      const timerRef = useRef(null);
      const audioPlayerRef = useRef(null);

      // Keep onActiveChange(false) so the toolbar doesn't push the controls left or hide the model selector!
      useEffect(() => {
        if (typeof onActiveChange === 'function') {
          onActiveChange(false);
        }
      }, [onActiveChange]);

      // On startup: fetch saved config from host backend and synchronize with local state
      useEffect(() => {
        fetch('/api/voice-input/config')
          .then(res => res.json())
          .then(data => {
            if (data && data.ok && data.config) {
              const serverConfig = data.config;
              setConfig(prev => {
                const merged = {
                  url: serverConfig.url || prev.url || '',
                  apiKey: serverConfig.apiKey || prev.apiKey || '',
                  model: serverConfig.model || prev.model || 'gemini-3.8-flash-high'
                };
                saveConfig(merged);
                return merged;
              });
            }
          })
          .catch(() => {});
      }, []);

      // Reset when session changes
      useEffect(() => {
        cleanupAll();
      }, [sessionId]);

      // The success note is a moment, not a state: return to the microphone.
      useEffect(() => {
        if (mode !== 'success') return;
        const handle = setTimeout(() => {
          setMode('idle');
          setStatusMsg('');
          setPeaks(null);
        }, 2600);
        return () => clearTimeout(handle);
      }, [mode]);

      // Hand the current view to the strip that lives in the composer dock.
      useEffect(() => {
        recorderView.publish({
          mode,
          peaks,
          analyserRef,
          playbackState,
          playbackCurrentTime,
          recordSeconds,
          statusMsg,
          pauseRecording,
          resumeRecording,
          stopRecordingToReview,
          playAudio,
          pauseAudio,
          sendRecording,
          cleanupAll
        });
      });

      // Nothing of the recorder should outlive it inside the dock.
      useEffect(() => () => recorderView.publish(null), []);

      // Listen for Escape key to close modal or cancel
      useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.key === 'Escape') {
            if (settingsOpen) {
              setSettingsOpen(false);
            }
          }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
      }, [settingsOpen]);

      const cleanupAudioPlayer = useCallback(() => {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          audioPlayerRef.current.src = '';
          audioPlayerRef.current = null;
        }
        setPlaybackState('stopped');
        setPlaybackCurrentTime(0);
      }, []);

      const cleanupRecorder = useCallback(() => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          try {
            mediaRecorderRef.current.stop();
          } catch (e) {}
        }
        mediaRecorderRef.current = null;
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(t => t.stop());
          mediaStreamRef.current = null;
        }
        detachMeter();
        recordedChunksRef.current = [];      }, []);

      const cleanupAll = useCallback(() => {
        cleanupRecorder();
        cleanupAudioPlayer();
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          setAudioUrl(null);
        }
        setAudioBlob(null);
        setPeaks(null);
        setMode('idle');
        setRecordSeconds(0);
        setStatusMsg('');
        setErrorMsg('');
        setIsPermissionError(false);
      }, [cleanupRecorder, cleanupAudioPlayer, audioUrl]);

      /** Route a microphone stream through an analyser for the live wave. */
      const attachMeter = (stream) => {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          const audioContext = new AudioCtx();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.65;
          const sink = audioContext.createGain();
          sink.gain.value = 0;
          source.connect(analyser);
          analyser.connect(sink);
          sink.connect(audioContext.destination);
          audioContextRef.current = audioContext;
          analyserRef.current = analyser;
        } catch (error) {
          console.warn('[voice-recorder] Live level meter unavailable', error);
          analyserRef.current = null;
        }
      };

      /** Release the analyser so the strip stops following the microphone. */
      const detachMeter = () => {
        analyserRef.current = null;
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
      };

      /** Measure the shape of a recording so the wave can show real audio. */
      const measurePeaks = async (blob) => {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          const context = new AudioCtx();
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          const channel = decoded.getChannelData(0);
          const buckets = 512;
          const step = Math.max(1, Math.floor(channel.length / buckets));
          const shape = new Array(buckets);
          for (let bucket = 0; bucket < buckets; bucket++) {
            let peak = 0;
            const from = bucket * step;
            const to = Math.min(from + step, channel.length);
            for (let index = from; index < to; index += 6) {
              const value = Math.abs(channel[index]);
              if (value > peak) peak = value;
            }
            shape[bucket] = Math.min(1, peak * 1.7);
          }
          await context.close().catch(() => {});
          setPeaks(shape);
        } catch (error) {
          console.warn('[voice-recorder] Could not measure the recorded shape', error);
          setPeaks(null);
        }
      };

      // Start Recording directly
      const startRecording = async () => {
        setErrorMsg('');
        setIsPermissionError(false);
        cleanupAudioPlayer();
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          setAudioUrl(null);
        }
        setAudioBlob(null);
        setRecordSeconds(0);

        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('navigator.mediaDevices.getUserMedia is not supported in this environment');
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true
            }
          });
          mediaStreamRef.current = stream;
          attachMeter(stream);

          let mimeType = 'audio/webm';
          if (!MediaRecorder.isTypeSupported('audio/webm')) {
            if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
            else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
            else mimeType = '';
          }

          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;
          recordedChunksRef.current = [];

          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              recordedChunksRef.current.push(e.data);
            }
          };

          recorder.start(250);
          setMode('recording');

          timerRef.current = setInterval(() => {
            setRecordSeconds(sec => sec + 1);
          }, 1000);
        } catch (err) {
          console.error('[voice-recorder] Failed to start microphone', err);
          const isPerm = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || String(err).includes('Permission denied');
          setIsPermissionError(isPerm);
          setErrorMsg(err.message || String(err));
          setMode('idle');
        }
      };

      // Pause Recording
      const pauseRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.pause();
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          detachMeter();
          measurePeaks(new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current.mimeType || 'audio/webm' }));
          setMode('recording_paused');
        }
      };

      // Resume Recording
      const resumeRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
          mediaRecorderRef.current.resume();
          if (mediaStreamRef.current) attachMeter(mediaStreamRef.current);
          timerRef.current = setInterval(() => {
            setRecordSeconds(sec => sec + 1);
          }, 1000);
          setMode('recording');
        }
      };

      // Stop Recording and switch to Review mode
      const stopRecordingToReview = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const recorder = mediaRecorderRef.current;
        if (!recorder) return;

        recorder.onstop = () => {
          const rawMime = recorder.mimeType || 'audio/webm';
          const blob = new Blob(recordedChunksRef.current, { type: rawMime });
          setAudioBlob(blob);
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
          }
          detachMeter();
          setMode('review');

          measurePeaks(blob);
        };

        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      };

      // Playback audio
      const playAudio = () => {
        if (!audioUrl) return;

        if (playbackState === 'paused' && audioPlayerRef.current) {
          audioPlayerRef.current.play();
          setPlaybackState('playing');
          return;
        }

        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          audioPlayerRef.current = null;
        }

        const player = new Audio(audioUrl);
        audioPlayerRef.current = player;

        player.ontimeupdate = () => {
          setPlaybackCurrentTime(player.currentTime);
        };

        player.onended = () => {
          setPlaybackState('stopped');
          setPlaybackCurrentTime(0);
        };

        player.onerror = (e) => {
          console.warn('[voice-recorder] Playback error', e);
          setPlaybackState('stopped');
        };

        player.play().then(() => {
          setPlaybackState('playing');
        }).catch(err => {
          console.warn('[voice-recorder] Playback prevented', err);
          setPlaybackState('stopped');
        });
      };

      const pauseAudio = () => {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          setPlaybackState('paused');
        }
      };

      const stopAudio = () => {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
          audioPlayerRef.current.currentTime = 0;
          setPlaybackState('stopped');
          setPlaybackCurrentTime(0);
        }
      };

      // Send recording to backend proxy
      const sendRecording = async () => {
        cleanupAudioPlayer();
        setErrorMsg('');
        setIsPermissionError(false);
        setMode('sending');
        setStatusMsg('Preparing audio...');

        let blobToSend = audioBlob;

        // If user clicked Send directly while still recording
        if ((mode === 'recording' || mode === 'recording_paused') && mediaRecorderRef.current) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          blobToSend = await new Promise((resolve) => {
            const recorder = mediaRecorderRef.current;
            recorder.onstop = () => {
              const rawMime = recorder.mimeType || 'audio/webm';
              const b = new Blob(recordedChunksRef.current, { type: rawMime });
              if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach(t => t.stop());
                mediaStreamRef.current = null;
              }
              resolve(b);
            };
            if (recorder.state !== 'inactive') {
              recorder.stop();
            } else {
              resolve(audioBlob);
            }
          });
          setAudioBlob(blobToSend);
        }

        if (!blobToSend || blobToSend.size === 0) {
          setErrorMsg('No audio was recorded to send');
          setMode('idle');
          return;
        }

        try {
          setStatusMsg('Converting audio to WAV...');
          const wavBlob = await convertToWavBlob(blobToSend);
          const base64 = await blobToBase64(wavBlob);

          // Read the newest persisted provider settings: the plugin page writes
          // them without remounting this recorder.
          const latest = loadSavedConfig();

          setStatusMsg(`Transcribing with ${latest.model}...`);

          const res = await fetch('/api/voice-input/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              audioBase64: base64,
              format: 'wav',
              url: latest.url,
              apiKey: latest.apiKey,
              model: latest.model
            })
          });

          const data = await res.json();

          if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }

          const transcribedText = (data.text || '').trim();
          if (!transcribedText) {
            throw new Error('Transcribed text was empty');
          }

          // Insert text into composer draft
          let inserted = false;
          if (inputActions && typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
            try {
              const span = inputActions.captureInsertion();
              inserted = inputActions.insertText(transcribedText, span);
            } catch (e) {
              inserted = false;
            }
          }
          if (!inserted && inputActions && typeof inputActions.setDraft === 'function') {
            try {
              inputActions.setDraft(transcribedText);
              inserted = true;
            } catch (e) {
              inserted = false;
            }
          }

          setStatusMsg(`✓ Transcribed: "${transcribedText.slice(0, 30)}${transcribedText.length > 30 ? '...' : ''}"`);
          setMode('success');

          setTimeout(() => {
            cleanupAll();
          }, 2000);
        } catch (err) {
          console.error('[voice-recorder] Send failed', err);
          setErrorMsg('Transcription failed: ' + (err.message || String(err)));
          setMode('review');
        }
      };

      // Settings modal
      const openSettings = () => {
        fetch('/api/voice-input/config')
          .then(res => res.json())
          .then(data => {
            if (data && data.ok && data.config) {
              const serverConfig = data.config;
              const merged = {
                url: serverConfig.url || config.url || '',
                apiKey: serverConfig.apiKey || config.apiKey || '',
                model: serverConfig.model || config.model || 'gemini-3.8-flash-high'
              };
              setConfig(merged);
              setTempConfig(merged);
              saveConfig(merged);
            } else {
              setTempConfig({ ...config });
            }
          })
          .catch(() => {
            setTempConfig({ ...config });
          })
          .finally(() => {
            setSettingsOpen(true);
          });
      };

      const handleSaveSettings = () => {
        setConfig(tempConfig);
        saveConfig(tempConfig);
        setSettingsOpen(false);

        // Notify backend to write to permanent disk storage
        fetch('/api/voice-input/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tempConfig)
        }).then(res => res.json()).then(data => {
          if (data && data.ok && data.config) {
            setConfig(data.config);
            saveConfig(data.config);
          }
        }).catch(err => console.warn('[voice-input] Failed to sync config with host', err));
      };

      return h('div', { className: 'dsh-vr-container' },
        h('style', null, STYLES),

        // Centered Modal Dialog for Settings
        settingsOpen && h('div', {
          className: 'dsh-vr-modal-backdrop',
          onClick: (e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }
        },
          h('div', { className: 'dsh-vr-modal-card' },
            h('div', { className: 'dsh-vr-modal-header' },
              h('div', { className: 'dsh-vr-modal-title' },
                h(IconGear),
                h('span', null, 'Voice Provider Settings')
              ),
              h('button', {
                className: 'dsh-vr-modal-close-btn',
                title: 'Close (Esc)',
                'aria-label': 'Close settings',
                onClick: () => setSettingsOpen(false)
              }, h(IconClose))
            ),
            h('div', { className: 'dsh-vr-form-group' },
              h('label', { className: 'dsh-vr-label' }, 'Provider API Base URL'),
              h('input', {
                className: 'dsh-vr-input',
                type: 'text',
                value: tempConfig.url,
                placeholder: 'http://your-provider-host:8000/v1',
                onChange: (e) => setTempConfig({ ...tempConfig, url: e.target.value })
              })
            ),
            h('div', { className: 'dsh-vr-form-group' },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
                h('label', { className: 'dsh-vr-label', style: { marginBottom: 0 } }, 'API Key'),
                h('button', {
                  type: 'button',
                  style: { background: 'none', border: 'none', color: 'var(--dsw-alias-brand-primary, #2080f0)', cursor: 'pointer', fontSize: 11 },
                  onClick: () => setShowApiKey(!showApiKey)
                }, showApiKey ? 'Hide' : 'Show')
              ),
              h('input', {
                className: 'dsh-vr-input',
                type: showApiKey ? 'text' : 'password',
                value: tempConfig.apiKey,
                placeholder: 'your-api-key',
                onChange: (e) => setTempConfig({ ...tempConfig, apiKey: e.target.value })
              })
            ),
            h('div', { className: 'dsh-vr-form-group' },
              h('label', { className: 'dsh-vr-label' }, 'Model ID'),
              h('input', {
                className: 'dsh-vr-input',
                type: 'text',
                value: tempConfig.model,
                placeholder: 'gemini-3.8-flash-high',
                onChange: (e) => setTempConfig({ ...tempConfig, model: e.target.value })
              })
            ),
            h('div', { className: 'dsh-vr-modal-footer' },
              h('button', {
                className: 'dsh-vr-modal-btn',
                onClick: () => setSettingsOpen(false)
              }, 'Cancel'),
              h('button', {
                className: 'dsh-vr-modal-btn',
                onClick: () => setTempConfig({ ...DEFAULT_CONFIG })
              }, 'Reset Defaults'),
              h('button', {
                className: 'dsh-vr-modal-btn dsh-vr-modal-btn-save',
                onClick: handleSaveSettings
              }, 'Save')
            )
          )
        ),

        // Floating Error / Permission Notice Toast
        errorMsg && h('div', { className: 'dsh-vr-error-toast' },
          h('div', { className: 'dsh-vr-error-header' },
            h('span', { className: 'dsh-vr-error-title' },
              isPermissionError ? 'Microphone Permission Notice' : 'Voice Recorder Error'
            ),
            h('button', {
              className: 'dsh-vr-modal-close-btn',
              style: { width: 22, height: 22 },
              onClick: () => setErrorMsg('')
            }, h(IconClose))
          ),
          h('div', { className: 'dsh-vr-error-body' },
            isPermissionError ? h('div', null,
              h('p', { style: { margin: '0 0 6px 0' } }, 'Microphone access was denied or is blocked by the desktop app.'),
              h('p', { style: { margin: '0 0 6px 0', fontSize: 11, opacity: 0.9 } },
                'Tip: You can also use the Harness Web GUI directly in your browser at ',
                h('strong', null, 'http://127.0.0.1:43129'),
                ', where Chrome/Edge allows microphone access immediately.'
              )
            ) : h('div', null, errorMsg)
          ),
          h('div', { className: 'dsh-vr-error-actions' },
            h('button', {
              className: 'dsh-vr-modal-btn',
              style: { padding: '3px 10px', fontSize: 12 },
              onClick: () => setErrorMsg('')
            }, 'Dismiss')
          )
        ),

        // Mode: IDLE — the microphone is the only control here; provider
        // settings live on the plugin's own page in Plugins.
        mode === 'idle' && h('div', { className: 'dsh-vr-idle-wrap' },
          h('button', {
            className: 'dsh-vr-btn',
            title: `Voice record (${config.model})`,
            'aria-label': 'Record voice',
            onClick: startRecording
          }, h(IconMic))
        ),

        // Mode: SENDING — the capsule is already gone; the wait shows here.
        mode === 'sending' && h('div', { className: 'dsh-vr-idle-wrap', title: statusMsg || 'Transcribing...' },
          h('span', { className: 'dsh-vr-spinner' })
        ),

        // Mode: SUCCESS — a moment of confirmation beside the microphone.
        mode === 'success' && h('div', { className: 'dsh-vr-idle-wrap', title: statusMsg || 'Inserted' },
          h('span', { className: 'dsh-vr-check' }, h(IconCheck))
        ),

        // Recording, pause and review are drawn by the capsule in the composer
        // overlay (VoiceStripHost): the toolbar keeps nothing but the microphone,
        // so the Send button is never crowded.
        null
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
          name: 'conversation.input.activity',
          id: 'voice-input',
          order: 1
        }, VoiceRecorder));

        // The voice bar is a capsule over the composer input, the way a voice
        // message replaces the field it is recorded into.
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'voice-input-bar',
          order: 0
        }, VoiceStripHost));

        // Provider settings belong to the plugin, not to the composer toolbar:
        // they render on the bundle's own page in Plugins, and on the row's page
        // behind its Configure control.
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-voice-input'
        }, VoiceProviderSettingsSlot));

        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: 'dsh-voice-input#voice-input'
        }, VoiceProviderSettingsSlot));
      }
    };
  }
});
