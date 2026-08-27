# Voice Note Transcriber — Design Spec

**Date:** 2026-08-27
**Status:** Approved design, pre-implementation
**Owner:** Eran (personal tool, single user)

## What this is

A mobile web app (PWA) that records a voice note (up to 5 minutes), transcribes it, cleans it up with an LLM, and puts the result on the clipboard for pasting into chat apps (e.g. WhatsApp). The output must stay in the language spoken: Hebrew notes produce Hebrew text, English notes produce English text, and embedded foreign words (code-switching) stay in their original script.

## Decisions already made

| Question | Decision |
|---|---|
| Audience | Personal tool. No auth, no accounts, no billing. |
| Platform | Web app / PWA, added to iOS home screen. No native app. |
| Hosting | **Netlify**, static site. HTTPS required for mic access — included. |
| Backend | None. API key lives in the phone's localStorage; Safari calls OpenAI directly. Fallback if browser-direct calls break: a Netlify Function proxy in the same repo. |
| Models | All OpenAI, one key: `gpt-4o-transcribe` for ASR, `gpt-4o` for cleanup (a one-line constant to change). Both behind swappable interfaces. |
| Cleanup level | Med-heavy: restructure and tighten, preserve voice (see Prompt section). |
| Code-switching | Keep exactly as spoken — embedded English words stay in Latin script inside Hebrew text, and vice versa. Never translate or transliterate. |
| History | None. No persistence of notes. |
| Audio retention | Recording lives in memory only; the blob is released after transcription succeeds. Nothing uploaded anywhere except to OpenAI for transcription. |
| v1 result screen | Editable textarea + explicit Copy button + collapsed "raw transcript" section. |

## Architecture

Single-screen state machine, one page, no router:

```
idle → recording → transcribing → cleaning → result
```

### Pipeline

```
mic → MediaRecorder (audio/mp4) → Blob (in memory)
    → POST api.openai.com/v1/audio/transcriptions  → raw transcript
    → detect script client-side (Hebrew vs Latin character count)
    → POST api.openai.com/v1/chat/completions      → cleaned text
    → release Blob
    → render result (editable, dir="auto") → user taps Copy
```

5 minutes of iOS AAC ≈ 3–5 MB — under the 25 MB single-request limit, so no chunking.

### Modules

| File | Responsibility |
|---|---|
| `recorder.js` | Mic permission, MediaRecorder, 5:00 cap with auto-stop-and-proceed, level meter. Knows nothing about APIs. |
| `transcribe.js` | Blob → raw text. One provider function behind a small interface (swap-friendly). |
| `cleanup.js` | (text, language) → cleaned text. Owns the prompt. Swap-friendly. |
| `language.js` | Script detection. Pure function: counts Hebrew-block (U+0590–U+05FF) vs Latin characters, returns dominant language. |
| `clipboard.js` | iOS-safe `navigator.clipboard.writeText` inside the Copy tap gesture + success feedback. |
| `settings.js` | API key entry, stored in localStorage. Validates key presence before recording starts. |
| `app.js` | State machine wiring the above. |

## Language preservation (core requirement)

Two independent locks; the LLM is never trusted to infer the language:

1. **Transcription runs with auto-detect** — no `language` hint, so embedded English inside Hebrew comes back as English words, not suppressed or transliterated.
2. **Client-side script detection** (`language.js`) determines the dominant language deterministically from the transcript's characters.
3. The detected language is injected into the cleanup prompt as an explicit constraint: *"The message is in Hebrew. Your entire output must be in Hebrew."* Plus a hard rule: embedded words in another language stay in their original script.

## Cleanup prompt (med-heavy)

**Do:** remove fillers (אמם, כאילו, um, like), false starts, repeated words; fix grammar and punctuation; merge rambling fragments into complete sentences; fold circled-back remarks into where they belong; drop pure detours ("wait, someone's at the door"); add paragraph breaks in longer notes.

**Don't:** translate anything; change slang or personal tone into "proper" writing; add content, greetings, or sign-offs that weren't spoken; summarize — same message, tighter.

**Output rule:** return only the cleaned message, no preamble — output goes straight into the copy box.

## Error handling

Principle: **never lose the recording's content; always leave the user one tap from recovery.**

| Failure | Behavior |
|---|---|
| Mic permission denied | Clear message with steps to re-enable in iOS Settings |
| Transcription call fails | "Retry" button — audio blob still in memory, no re-recording |
| Cleanup call fails | Show raw transcript anyway + "Retry cleanup" button; raw text is copyable |
| Missing/invalid API key | Caught before recording starts, never after speaking |
| App backgrounded mid-recording | On return, offer to transcribe what was captured |
| 5:00 limit reached | Auto-stop and proceed with what was recorded (never discard) |

The audio blob is released only after transcription succeeds — that is what makes retry free.

## Testing

- **Unit tests (CI on every push):** `language.js` (Hebrew → `he`, English → `en`, mixed → dominant script) and state-machine transitions.
- **Prompt fixture check (semi-manual):** ~10 messy transcripts (Hebrew, English, mixed, with fillers) run through the cleanup call in one command; output eyeballed for "sounds like me." Re-run whenever the prompt changes.
- **Real-device end-to-end:** record Hebrew with embedded English → paste into WhatsApp → reads naturally.

## Day-one spikes (before building anything else)

1. **Mic in a standalone PWA:** confirm `getUserMedia` works on the user's actual iPhone when the app is launched from the home screen (historically broken pre-iOS 14.5; must verify on current iOS).
2. **CORS to OpenAI:** confirm Safari can call `api.openai.com` directly from the Netlify origin. The no-backend decision rests on this.

If either fails → fallback is a Netlify Function proxy: same repo, same deploy, one extra file. The app's module boundaries make this a change inside `transcribe.js`/`cleanup.js` only.

## Out of scope (v1)

- History / persistence of notes
- Multiple cleanup levels or per-note toggles
- Auto-copy without a tap (fragile on iOS; explicit Copy button instead)
- Share Sheet / Shortcuts integration (native-only features)
- Accounts, quotas, any server-side state
