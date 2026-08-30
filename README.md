# Transcriber

Personal voice-note PWA. Record → transcribe → clean up → copy to clipboard.

**Live:** https://the-transcriber.netlify.app

## What it does

1. Record up to 5 minutes of audio from your microphone
2. Transcribe with OpenAI `gpt-4o-transcribe`
3. Clean up the transcript with Claude Sonnet 5 (Anthropic) (remove filler words, fix grammar, tighten sentences)
4. Copy the result to clipboard for pasting into WhatsApp or any chat app

Language is preserved automatically — Hebrew stays Hebrew, English stays English, and code-switched words stay in their original script.

## Setup

No backend, no accounts. The app calls OpenAI and Anthropic directly from your browser.

1. Open the app and tap **Settings**
2. Paste your [OpenAI API key](https://platform.openai.com/api-keys) — used for transcription
3. Paste your [Anthropic API key](https://console.anthropic.com/settings/keys) — used for cleanup. This one is optional: without it you'll get the raw transcript instead of a cleaned-up one

Both keys are stored in your browser's localStorage and never leave your device.

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
| `src/cleanup.js` | Anthropic Messages API call for transcript cleanup |
| `src/language.js` | Hebrew/English detection by character count |
| `src/settings.js` | API key in localStorage |
| `src/clipboard.js` | `navigator.clipboard.writeText` wrapper |

## Notes

- iOS Safari produces `audio/mp4` (AAC) — the transcription API accepts it
- Clipboard write must be called synchronously inside a tap handler on iOS
- The home-screen PWA and Safari have separate localStorage — enter your API key inside the installed app, not in Safari
