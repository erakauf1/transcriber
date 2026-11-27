# iOS Design Refresh — Design

Date: 2026-11-27
Status: Approved in brainstorming, awaiting spec review

## Goal

Give the native iOS app one consistent, polished visual language across the whole flow (Idle → Recording → Processing → Result, plus History, Note detail, Settings and Interrupted), based on "Direction A · Native, refined": white cards on the iOS grouped gray background, system blue accent, one clear primary action per screen.

The trigger was the Result screen on TestFlight: the text box filled the whole screen for a two-line note, Hebrew refine chips were clipped on the right, and Copy, Share and New note had equal weight.

## Scope

### In

- A shared style file and a restyle of every view in `ios/Transcriber/Views/`.
- Recording duration stored on notes and shown on Processing, Result and History.
- A persistent "✓ Copied" indicator on Result.
- History grouped by day.

### Not in

- Hebrew UI strings or RTL mirroring of the app chrome. The UI stays English. Only note text and refine chips follow the note's direction.
- New features, behavior changes to recording, transcription, cleanup or refine.
- `TranscriberCore` prompt or API changes, and anything in the web app.

## Shared style — `ios/Transcriber/Views/Style.swift`

All colors are semantic, so dark mode works without extra code.

| Piece | Definition |
|---|---|
| Page background | `Color(.systemGroupedBackground)`, applied once in `ContentView` with `.ignoresSafeArea()` |
| `CardBackground` modifier (`.card()`) | padding 14, `Color(.secondarySystemGroupedBackground)`, `RoundedRectangle(cornerRadius: 14, style: .continuous)` |
| `PrimaryButtonStyle` | full width, 15pt semibold white label, `Color.accentColor` fill, corner 13, min height 48, 0.6 opacity when pressed or disabled |
| `IconButtonStyle` | 44×44, card background, corner 13, accent-colored SF Symbol |
| `ChipButtonStyle` | capsule, 12–13pt label, accent text, card background, 1pt `Color(.separator)` stroke, 0.4 opacity when disabled |
| `MetaRow(leading:trailing:)` | `HStack` of two `Text`s, `.caption2`, `.secondary`, `Spacer` between |

## Screens

### Idle (`IdleView`)

- Centered 112pt circle mic button, accent fill, white `mic.fill`, soft accent shadow (radius ~15, opacity 0.35).
- Hint under it: "Tap to record" / "Up to 5 minutes" in `.footnote` secondary.
- No-key state: mic disabled (gray), hint replaced by "Add your OpenAI key in Settings to start." in a card.
- Mic-denied banner: shown in a card with the existing "Open Settings" button.
- Toolbar (`ContentView`): icon-only buttons, `clock` leading and `gearshape` trailing, still idle-only. Accessibility labels "History" and "Settings" kept.

### Recording (`RecordingView`)

- Top to bottom, centered: red "● REC" (`.caption.weight(.semibold)`), timer (44pt light, monospaced digits), the existing level bars (4pt wide, 3pt gap, height up to 70), then "m:ss left" computed as `max(0, 300 − elapsed)`.
- Stop button near the bottom: 84pt white circle (card background) with a 28pt red rounded square (corner 7), light shadow. Accessibility label "Stop recording".
- The silent style still grays the bars.

### Processing (`ProcessingView`)

A card with three step rows separated by dividers:

1. "Recorded · m:ss": green checkmark circle (always done here).
2. "Transcribing": spinner while `phase == .transcribing`, done once in `.cleaning`.
3. "Cleaning up": gray ring while transcribing, spinner while `.cleaning`.

The active row's label is semibold, pending rows are secondary. Under the card: "You can leave the app. The result will be copied." in `.footnote` secondary.

On a transcription error: row 2 shows a red `exclamationmark.circle.fill` and the error text under the card in red. Then the existing `Retry` (primary style) and `Later` buttons, plus the existing "The recording is saved in History…" footnote.

### Result (`ResultView`)

Top to bottom:

1. `MetaRow`: leading "Just now · m:ss" (duration omitted if unknown), trailing "✓ Copied" in green when `model.isCopied`.
2. Cleanup-failed banner (only when `state.error != nil`): an orange-tinted card with the message and a "Retry cleanup" button.
3. Text card: replace `TextEditor` with `TextField("", text: $draft, axis: .vertical)` and `.lineLimit(2...14)` inside `.card()`, 17pt body. It grows with the text and scrolls past 14 lines, so a short note gets a short card. Layout direction follows the note's language (unchanged).
4. `MetaRow`: leading "Tap text to edit", trailing the cost text.
5. Refining progress and refine/chip errors (unchanged content, `.footnote`).
6. Chips: horizontal `ScrollView` with `.environment(\.layoutDirection, language == .he ? .rightToLeft : .leftToRight)` on the scroll view, so Hebrew chips start at the right edge. `ChipButtonStyle`.
7. `Spacer`, then the bottom bar: `ShareLink` in `IconButtonStyle` (`square.and.arrow.up`), **Copy** in `PrimaryButtonStyle` (label "Copy", or "Copy again" when `isCopied`), New note in `IconButtonStyle` (`plus`, label "New note").

The keyboard "Done" toolbar and draft commit logic stay as they are.

### Interrupted (`InterruptedView` in `ContentView`)

Title and explanation in a card. "Transcribe it" in `PrimaryButtonStyle`, "Discard" as a plain destructive button.

### History (`HistoryView`)

- `List` with `.insetGrouped` style, one `Section` per day. Headers: "Today", "Yesterday", otherwise the date (`.dateTime.weekday(.wide).day().month()`).
- `NoteRow`: text (2 lines, direction from the note's language, aligned to the leading edge of that direction), meta line `HH:mm · m:ss` (duration omitted if nil), then " · Not transcribed" / " · Raw only" in orange. The meta line is always left-to-right.
- The lock screen, export, unreadable-notes section and footer text are unchanged in behavior. The lock screen is restyled as a card with a primary Unlock button.

### Note detail and Settings

Note detail: the text in a `.card()` on the grouped background, meta row (date · duration · cost) above. Settings: stays a `Form`, with spacing and footer-copy pass only.

## Data and model changes

- `Note`: add `var durationSeconds: Double?`. SwiftData lightweight migration (new optional attribute), so no migration plan is needed. Old notes show no duration.
- `NoteSnapshot` and the `HistoryStore` save path carry `durationSeconds`.
- `AppModel`:
  - `recordedDuration: TimeInterval?`, set from `elapsed` when recording stops (and for the interrupted path), stored in the snapshot, reset in `reset()`. When History retries an old note, it is loaded from that note.
  - `isCopied: Bool`, true right after the app writes `currentText` to the pasteboard (auto-copy or Copy button). It becomes false when `currentText` changes (edit, refine) and in `reset()`.
- `TranscriberCore/HistoryGrouping.swift` (pure): `func groupByDay<T>(_ items: [T], date: (T) -> Date, now: Date, calendar: Calendar) -> [(title: DayTitle, items: [T])]`, where `DayTitle` is `.today`, `.yesterday` or `.date(Date)`. It keeps input order and groups adjacent days. The view maps `DayTitle` to a string.

## Testing

- Unit tests (Swift Testing, in `TranscriberCore`) for `groupByDay`: today and yesterday boundaries at midnight, older dates, empty input, order preserved.
- All existing `TranscriberCore` tests pass.
- The app builds with XcodeGen + `xcodebuild` for the simulator.
- Manual check in the iOS Simulator, with screenshots of each phase in light and dark mode, using one Hebrew and one English note. Check in particular: the Result card stays compact for short text and scrolls for long text, Hebrew chips start at the right edge with none clipped, "✓ Copied" appears after auto-copy and clears after a refine, and History shows Today/Yesterday sections with durations.

## Housekeeping

- Add `.superpowers/brainstorm/` to `.gitignore`.
