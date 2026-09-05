# Transcriber

Personal voice-note PWA. Record → transcribe → clean up → copy to clipboard.

**Live:** https://the-transcriber.netlify.app

## What it does

1. Record up to 5 minutes of audio from your microphone
2. Transcribe with OpenAI `gpt-4o-transcribe`
3. Clean up the transcript (remove filler words, fix grammar, tighten sentences), then optionally refine it further with one-tap suggestions
4. Copy the result to clipboard for pasting into WhatsApp or any chat app

Cleanup and Refine each independently use OpenAI, Anthropic, or OpenRouter (which gives access to free/low-cost models from many providers) — pick a provider per step in Settings. Transcription is unaffected and always uses OpenAI.

Language is preserved automatically — Hebrew stays Hebrew, English stays English, and code-switched words stay in their original script.

## Setup

No backend, no accounts. The app calls OpenAI, Anthropic, and/or OpenRouter directly from your browser, depending on which provider is selected for each step.

1. Open the app and tap **Settings**
2. Paste your [OpenAI API key](https://platform.openai.com/api-keys) — used for transcription, and for Cleanup/Refine if you pick OpenAI for those steps
3. Paste your [Anthropic API key](https://console.anthropic.com/settings/keys) — used for Cleanup/Refine if you pick Anthropic for those steps
4. Paste your [OpenRouter API key](https://openrouter.ai/settings/keys) — used for Cleanup/Refine if you pick OpenRouter for those steps, including free/low-cost models

The OpenAI key is required (transcription always uses it). The Anthropic and OpenRouter keys are only needed for whichever steps you point at those providers — pick each step's provider and model under Settings. If a step's selected provider has no key saved, that step's action is disabled with a hint until you add one.

All keys are stored in your browser's localStorage and never leave your device.

To install as a PWA on iOS: open in Safari → Share → Add to Home Screen.

## Development

```bash
npm install
npm run dev       # local dev server
npm test          # run tests
npm run build     # production build → dist/
```

Deploy to Netlify:

```bash
npx netlify deploy --prod --dir=dist
```

## Architecture

No runtime dependencies — Vite for bundling, Vitest for tests.

| File | Responsibility |
|------|----------------|
| `src/app.js` | State machine wiring, render loop |
| `src/state.js` | Pure reducer (phases: idle → recording → transcribing → cleaning → done) |
| `src/recorder.js` | MediaRecorder wrapper, 5-min cap, level metering |
| `src/transcribe.js` | OpenAI transcription API call |
| `src/loanwords.js` | Deterministic lookup table — restores transliterated work terms to Latin before cleanup |
| `src/cleanup.js` | Transcript cleanup via the selected provider |
| `src/refine.js` | One-tap refinement chips + apply, via the selected provider |
| `src/llmClient.js` | Shared request helper used by `cleanup.js` and `refine.js` for all three providers (OpenAI, Anthropic, OpenRouter) |
| `src/language.js` | Hebrew/English detection by character count |
| `src/settings.js` | API keys and per-step provider/model selection in localStorage |
| `src/clipboard.js` | `navigator.clipboard.writeText` wrapper |

## Notes

- iOS Safari produces `audio/mp4` (AAC) — the transcription API accepts it
- Clipboard write must be called synchronously inside a tap handler on iOS
- The home-screen PWA and Safari have separate localStorage — enter your API key inside the installed app, not in Safari
