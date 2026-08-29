# Noise Suppression & Voice Activity Detection

## Summary

Integrate real-time noise suppression and amplitude-based voice activity detection into the Voice Note recording pipeline to improve transcription accuracy, especially in noisy on-the-go environments (walking, driving, crowded spaces).

## Goals

- Cleaner audio sent to OpenAI → better transcription accuracy
- Visual feedback during recording showing speech vs. silence
- User-toggleable noise suppression via Settings
- Zero impact on recording reliability — graceful fallback if suppression fails to load

## Non-Goals

- ML-based VAD (iOS Safari WASM SIMD issues with @ricky0123/vad-web)
- Byte-level silence trimming of audio blobs (future enhancement)
- Speaker diarization
- Offline/local transcription

## Architecture

### Current Pipeline

```
getUserMedia → MediaRecorder (records raw mic)
            ↘ AudioContext → AnalyserNode (level meter only, not in recording path)
```

### New Pipeline

```
getUserMedia → AudioContext → RnnoiseWorkletNode → MediaStreamDestination → MediaRecorder
                                                 ↘ AnalyserNode (level meter + VAD)
```

The noise suppressor is inserted into the recording path via Web Audio API. The MediaRecorder receives a clean MediaStream from `createMediaStreamDestination()`. The AnalyserNode reads post-suppression audio, so both the level meter and VAD operate on clean signal.

When noise suppression is disabled, the source connects directly to the destination node (passthrough, no processing overhead).

## New Modules

### `src/audio-pipeline.js`

Creates and manages the Web Audio processing graph.

**API:**
```js
createPipeline(stream, { noiseSuppression: boolean })
  → { cleanStream: MediaStream, analyser: AnalyserNode, destroy: () => void }
```

- Owns the AudioContext lifecycle (replaces the recorder's ad-hoc AudioContext)
- Lazy-loads the AudioWorklet module and RNNoise WASM on first use with `noiseSuppression: true`
- Caches loaded state so subsequent recordings start instantly
- When `noiseSuppression: false`, connects source → destination directly
- `destroy()` disconnects all nodes and closes the AudioContext

**Node graph detail:** The suppressor output fans to two destinations:
```
source → [RnnoiseWorkletNode] → MediaStreamDestination (→ MediaRecorder)
                               ↘ AnalyserNode (→ level meter + VAD)
```
Both the destination and analyser connect to the suppressor's output (or directly to source when suppression is off).

**Capability check:** Exports `checkNoiseSuppressionSupport() → Promise<boolean>` — probes for AudioWorklet and WASM support without loading the full model. Called once on app boot to determine whether the Settings toggle should show "Unavailable".

**Fallback:** If AudioWorklet or WASM fails to load at recording time, logs a warning and falls back to passthrough (raw mic → MediaStreamDestination). Recording never fails because of the suppressor.

### `src/vad.js`

Simple amplitude-based voice activity detector.

**API:**
```js
createVAD(analyser, { onSpeechStart, onSpeechEnd, threshold?, silenceMs? })
  → { start: () => void, stop: () => void, isSpeaking: () => boolean }
```

**Detection logic:**
- Reads AnalyserNode time-domain data on `requestAnimationFrame` (shares the existing level-meter loop pattern)
- **Speech start**: peak exceeds threshold (`0.05` default) for 2+ consecutive frames
- **Speech end**: peak stays below threshold for `silenceMs` (`800ms` default) continuously
- Fires `onSpeechStart` / `onSpeechEnd` callbacks
- Tracks `speechRanges[]` array of `{ startMs, endMs }` pairs (relative to VAD start) for future trimming use

**Post-suppression advantage:** With background noise removed, amplitude thresholding reliably separates speech from silence — the main failure mode of amplitude VAD (loud non-speech noise) is mitigated by the suppressor upstream.

## Modified Modules

### `src/recorder.js`

- No longer creates its own AudioContext (pipeline owns it)
- `createRecorder()` options gain `noiseSuppression: boolean` (default `true`), stored on the instance
- `start()` calls `createPipeline(stream, { noiseSuppression })` after `getUserMedia` and feeds `pipeline.cleanStream` to MediaRecorder
- Level meter uses the pipeline's `analyser` instead of creating its own
- Exposes `getAnalyser()` so app.js can pass it to the VAD after recording starts
- `teardown()` calls `pipeline.destroy()` alongside existing cleanup

### `src/app.js`

- Passes `noiseSuppression` setting from `getNoiseSuppressionEnabled()` to `createRecorder()`
- Creates VAD from `recorder.getAnalyser()` after recording starts
- VAD `onSpeechStart` / `onSpeechEnd` callbacks drive the wave-bar amplitude:
  - Speech detected: `--amp` set from live level meter (current behavior)
  - Silence detected: `--amp` pulled toward `0.15` (minimal bar height, visual "listening" state)
- No new DOM elements needed

### `src/settings.js`

- New functions: `getNoiseSuppressionEnabled()`, `setNoiseSuppressionEnabled(bool)`
- Persisted to localStorage key `noiseSuppressionEnabled`, default `true`

### `index.html`

- New toggle row in the Settings sheet, below the API key field:
  ```
  Noise suppression    [ON/OFF toggle]
  Reduces background noise for cleaner transcriptions
  ```
- Toggle shows "Unavailable" if `checkNoiseSuppressionSupport()` returns false on app boot

## Library

**`@sapphi-red/web-noise-suppressor`** (v0.3.5)
- Uses `RnnoiseWorkletNode` — RNNoise is trained on speech data, best fit for voice notes
- AudioWorklet-based, works on iOS Safari 14.5+
- No WASM SIMD requirement (unlike vad-web)
- WASM binary ~90KB
- Vite handles worklet URL and WASM asset via `?url` import syntax

## Settings Toggle UX

| State | Toggle | Subtitle |
|-------|--------|----------|
| Enabled | ON | Reduces background noise for cleaner transcriptions |
| Disabled | OFF | (same subtitle) |
| Load failed | Disabled, greyed | Not supported on this browser |

Default: ON. Stored in localStorage.

## Visual Speech Indicator

No new UI elements. The existing wave bars communicate recording activity; the VAD makes them smarter:

- **Speech detected**: wave bars animate at live level (current behavior, `--amp` from level meter)
- **Silence detected**: wave bars scale to minimal height (`--amp: 0.15`), signaling "listening but no speech"

Transition is immediate (no animation easing on the `--amp` change) so the indicator feels responsive.

## Error Handling

- **AudioWorklet/WASM load failure**: Fall back to passthrough. Log warning. Settings toggle shows "Unavailable".
- **AudioContext creation failure**: Same as current behavior — `recorder.start()` rejects, user sees error alert.
- **Mid-recording failure**: If the suppressor node errors during recording, the audio path is already established — WebAudio typically continues flowing. No special handling needed.

## Testing

- Unit tests for `vad.js` detection logic (mock AnalyserNode with known peak sequences)
- Unit tests for `audio-pipeline.js` passthrough vs. suppression path selection
- Unit tests for settings persistence (`getNoiseSuppressionEnabled` / `setNoiseSuppressionEnabled`)
- Manual testing on iOS Safari (primary target) and Chrome desktop
- Manual A/B comparison: record the same voice note with suppression on/off in a noisy environment, compare OpenAI transcription quality

## Bundle Impact

- `@sapphi-red/web-noise-suppressor`: ~90KB WASM binary + small JS wrapper
- New source modules: `audio-pipeline.js` (~60 lines), `vad.js` (~50 lines)
- No other new runtime dependencies
