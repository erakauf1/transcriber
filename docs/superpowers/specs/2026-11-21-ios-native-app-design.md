# Native iOS App — Design

Date: 2026-11-21
Status: Draft, awaiting review

## Goal

A native SwiftUI version of the Transcriber PWA, distributed to the owner (and anyone they add) through **internal TestFlight**. It should feel like a real iOS app (A) and add a few things the browser can't do well (B): automatic copy, share, and a private, encrypted note history with export.

The web app on Netlify is unchanged and keeps being developed.

## Scope

### In v1

- Record (up to 5:00) → transcribe → clean up → optional one-tap refine → copy — the same flow and phases as the web app.
- Cleanup and Refine provider/model selection (OpenAI, Anthropic, OpenRouter), same as Settings on the web.
- Estimated LLM cost under the cleaned text.
- Auto-copy when cleanup finishes; share button.
- Encrypted on-device history, locked behind Face ID, with JSON export of raw vs. cleaned text.

### Not in v1

- **Learned fixes** (`corrections.js`, `correctionsStore.js`, `secureStore.js`, model hints, rule export/import). Planned for v2. In v1 the transcription prompt is the script hint only, with no glossary.
- **Noise suppression.** No RNNoise and no Apple voice processing. Plain recording only.
- Shortcuts / Action Button / Lock Screen intents, custom keyboard, iCloud sync, external TestFlight or App Store release.

## Platform and project layout

- iOS 26 minimum, SwiftUI, Swift 6.
- New `ios/` folder in this repo:
  - `ios/project.yml`: XcodeGen spec. The `.xcodeproj` is generated, never hand-edited, and not committed.
  - `ios/TranscriberCore/`: local Swift package with all logic that doesn't need UIKit (prompts, API clients, reducer, language detection, pricing, export encoding).
  - `ios/Transcriber/`: the app target (SwiftUI views, recorder, Keychain, SwiftData, Face ID).
  - `ios/TranscriberCore/Tests/`: Swift Testing tests.
- Bundle ID: `com.<owner>.transcriber` (final value chosen at App Store Connect setup).

## Module mapping

| Web (`src/`) | iOS | Notes |
|---|---|---|
| `state.js` | `Core/State.swift`: `enum Phase`, `struct AppState`, `func reduce(_:_:)` | Same events and transitions. Audio is released only on `TRANSCRIBE_OK`. The `interrupted` phase is kept for an audio session interruption (phone call, Siri). |
| `transcribe.js` | `Core/Transcriber.swift` | `URLSession` multipart upload of `note.m4a` to `gpt-4o-transcribe`, 120 s timeout, no `language` param, `SCRIPT_HINT` prompt only. Echo detection is skipped in v1 because there is no glossary. |
| `llmClient.js` | `Core/LLMClient.swift` | Anthropic and OpenAI-compatible (OpenAI, OpenRouter) paths, including `anthropicThinkingParams`, refusal handling, usage reporting, and OpenRouter attribution headers. |
| `cleanup.js`, `refine.js` | `Core/Cleanup.swift`, `Core/Refine.swift` | System prompts copied verbatim (minus learned-rule sections). |
| `language.js`, `hebrew.js`, `englishTerms.js` | `Core/Language.swift`, `Core/Hebrew.swift`, `Core/EnglishTerms.swift` | Only the parts cleanup and language detection use in v1. |
| `pricing.js` | `Core/Pricing.swift` | |
| `settings.js` | `App/Settings.swift` | API keys in the Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`). Provider and model per step in `UserDefaults`. Step actions are disabled with a hint when the chosen provider has no key, as on the web. |
| `recorder.js`, `vad.js` | `App/Recorder.swift` | `AVAudioRecorder`, AAC in `.m4a`, mono, 5:00 cap with auto-stop, metering at roughly 30 Hz drives the waveform. The VAD becomes a threshold on the metered peak (0.05, 800 ms hangover) that toggles the bars' "silent" style. |
| `audio-pipeline.js` | — | Removed, since there is no noise suppression. |
| `clipboard.js` | `UIPasteboard.general.string` | |
| `app.js` | SwiftUI views + `@Observable` `AppModel` | |

Prompt drift between JS and Swift is a known cost. The parity check is in Testing.

## Audio

- `AVAudioSession` category `.record`, mode `.default`.
- Background audio mode is enabled, so recording continues when the user switches apps. This removes the web app's "you left the app" interruption for app switches. A real interruption (a call) still goes to `interrupted` and keeps the partial file for transcription.
- Microphone permission is requested on first record. If it is denied, the app shows a hint that links to Settings.

## Auto-copy and share

- On `CLEANUP_OK`, or `CLEANUP_FAIL` with raw fallback, the text is written to `UIPasteboard` automatically and a "Copied" toast is shown.
- If the app is backgrounded during transcription or cleanup, the work continues under `beginBackgroundTask`. The pasteboard is written as soon as the result arrives, and written again (with the toast) when the app returns to the foreground, in case iOS dropped the background write. Whether a background write sticks is verified on device.
- `ShareLink` on the result screen shares the current text.
- A manual Copy button stays, as on the web.

## History (encrypted, Face ID–locked)

### Data

SwiftData model `Note`:

| Field | Stored as |
|---|---|
| `id`, `createdAt`, `language`, `provider`, `model`, `costUsd`, `status` (`done` / `transcriptionFailed` / `cleanupFailed`) | plain |
| `rawTranscript`, `cleanedText` | AES-GCM ciphertext (`Data`) |
| `pendingAudioFile` | file name of the retained `.m4a`, only while transcription has not succeeded |

### Encryption

- One 256-bit symmetric key (CryptoKit `SymmetricKey`) is created on first launch and stored in the Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. It is not synced and doesn't move to other devices or backups.
- `rawTranscript` and `cleanedText` are sealed with `AES.GCM` before they are written and opened on read, behind a small `NoteCipher` type.
- The SwiftData store uses `FileProtectionType.complete`. The folder of retained audio files uses `.completeUnlessOpen`, so a recording already in progress keeps writing after the phone locks. Both are marked `isExcludedFromBackup`.
- Consequence: history does **not** survive a device change or restore. Export is the user's backup. This is stated in the History screen's footer.
- If the Keychain key is missing or decryption fails (for example after a restore), the app shows "History from a previous device can't be read" and offers to clear it. It never crashes.

### Access

- Opening History requires `LAContext` authentication (`.deviceOwnerAuthentication`: Face ID with passcode fallback).
- The unlock lasts until the app has been in the background for more than 60 s, or until History is closed.
- Recording and the current result screen are never locked.
- The app switcher snapshot hides History content (a blur overlay when the scene goes inactive).

### Behaviour

- Each finished flow saves one `Note`, whose status reflects the outcome.
- Audio is deleted when transcription succeeds. A `transcriptionFailed` note keeps its audio and shows **Retry**.
- Tapping a note opens it and copies its text (the cleaned text if present, otherwise the raw transcript).
- Swipe to delete removes the note and any retained audio.
- Text direction per note follows its stored `language` (`he` → right-to-left), not the device locale.

### Export

- The History toolbar has **Export**, which builds a plain JSON file and offers it through the share sheet (AirDrop, Files, and so on). It is authenticated, because History is already unlocked.
- The format is an array ordered oldest first:

```json
[
  {
    "name": "2026-11-21T09-14-03",
    "text": "<raw transcript>",
    "cleaned": "<cleaned text or null>",
    "language": "he",
    "date": "2026-11-21T09:14:03Z",
    "provider": "anthropic",
    "model": "claude-sonnet-5-5"
  }
]
```

- `name` and `text` match `fixtures/transcripts.json`, so an export can be passed straight to `npm run prompt-check`. The extra fields are ignored there.
- The file is plain text once it leaves the app, and the export sheet says so in one line.

## Error handling

The same rules as the web app:

- A transcription failure keeps the audio and offers Retry.
- A cleanup failure shows the raw transcript as the result, with Retry cleanup.
- A refine failure keeps the current text and shows the error inline.
- Network, HTTP and refusal messages reuse the web wording from `llmClient.js` and `transcribe.js`.

## Testing

- `TranscriberCore` tests use Swift Testing and port the web tests that apply to v1: `state`, `language`, `cleanup` and `refine` request shapes (with a stub `URLProtocol`), `llmClient` (including thinking params), `pricing`, and the export encoder.
- `fixtures/transcripts.json` is read by the Swift tests from the repo root, so both platforms share one fixture file.
- `NoteCipher` round-trip test, plus a test that a ciphertext opened with the wrong key raises the "can't be read" error.
- Whether `swift test` runs before Xcode is installed (Command Line Tools have Swift 6.4) is checked in the first plan step. If it doesn't, all testing waits for Xcode.
- Manual on-device checks: recording quality vs. the PWA, backgrounding during cleanup, a call interruption, Face ID lock and timeout, export AirDropped to the Mac and run through `prompt-check`.

## Path to TestFlight

1. Install Xcode, then run `xcode-select -s` to point the command-line tools at it. Install XcodeGen (`brew install xcodegen`).
2. Build and run in the Simulator.
3. Run on the owner's iPhone with a free personal signing team.
4. Enroll in the Apple Developer Program ($99/yr) and create the App Store Connect app record and bundle ID.
5. Release metadata:
   - `NSMicrophoneUsageDescription`
   - `ITSAppUsesNonExemptEncryption = NO`. The app uses only Apple's encryption APIs for local data, plus HTTPS. Confirm against Apple's current export-compliance guidance at upload time.
   - App icon from `public/icons/icon-512.png`, upscaled to 1024 px or regenerated by `scripts/make-icons.js`.
   - Build number incremented on every upload.
6. Archive and upload, using Xcode Organizer at first. The exact CLI command is chosen once Xcode is installed.
7. Add internal testers in App Store Connect.
