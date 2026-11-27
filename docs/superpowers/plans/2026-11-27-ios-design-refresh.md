# iOS Design Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every screen of the native iOS app in one consistent "Direction A · Native, refined" look, and add recording duration, a persistent "✓ Copied" state and day-grouped History.

**Architecture:** A single shared `Views/Style.swift` holds the visual building blocks (card modifier, three button styles, a meta row, a duration formatter). Each view is rewritten against it. The only logic changes are a pure, unit-tested `groupByDay` in `TranscriberCore`, a new optional `durationSeconds` on `Note`/`NoteSnapshot`, and two small `AppModel` properties (`recordedDuration`, `isCopied`).

**Tech Stack:** Swift 6, SwiftUI (iOS 26), SwiftData, Swift Testing, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-11-27-ios-design-refresh-design.md`

## Global Constraints

- iOS 26 minimum, Swift 6 language mode. Branch: `feat/ios-design-refresh`.
- UI text stays English. Only note text and refine chips follow the note's language direction (`language == .he` → `.rightToLeft`).
- Use semantic colors only (`Color(.systemGroupedBackground)`, `Color(.secondarySystemGroupedBackground)`, `Color(.separator)`, `Color.accentColor`, `.secondary`), never hard-coded white/gray, so dark mode works.
- No behavior changes to recording, transcription, cleanup, refine, history encryption or locking.
- The `.xcodeproj` is generated. Never edit it; run `xcodegen generate`.
- Comments: sparse, only for non-obvious why.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Commands used throughout:**

- Core tests: `cd ios/TranscriberCore && swift test`
- App build: `cd ios && xcodegen generate && xcodebuild -project Transcriber.xcodeproj -scheme Transcriber -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -3` → expect `** BUILD SUCCEEDED **`

## File map

| File | Change |
|---|---|
| `ios/TranscriberCore/Sources/TranscriberCore/HistoryGrouping.swift` | Create: `DayTitle`, `DayGroup`, `groupByDay` |
| `ios/TranscriberCore/Tests/TranscriberCoreTests/HistoryGroupingTests.swift` | Create |
| `ios/Transcriber/History/Note.swift` | Add `durationSeconds` |
| `ios/Transcriber/History/HistoryStore.swift` | Save and load `durationSeconds` |
| `ios/Transcriber/AppModel.swift` | `NoteSnapshot.durationSeconds`, `recordedDuration`, `isCopied` |
| `ios/Transcriber/Views/Style.swift` | Create: shared style |
| `ios/Transcriber/Views/ContentView.swift` | Background, toolbar icons, Interrupted |
| `ios/Transcriber/Views/IdleView.swift` | Rewrite |
| `ios/Transcriber/Views/RecordingView.swift` | Rewrite |
| `ios/Transcriber/Views/ProcessingView.swift` | Rewrite |
| `ios/Transcriber/Views/ResultView.swift` | Rewrite |
| `ios/Transcriber/Views/HistoryView.swift` | Day sections, row meta, lock card |
| `ios/Transcriber/Views/NoteDetailView.swift` | Rewrite |
| `ios/Transcriber/Views/SettingsView.swift` | No change. It is already a grouped `Form`, which matches Direction A. |

---

### Task 1: Day grouping in TranscriberCore

**Files:**
- Create: `ios/TranscriberCore/Sources/TranscriberCore/HistoryGrouping.swift`
- Test: `ios/TranscriberCore/Tests/TranscriberCoreTests/HistoryGroupingTests.swift`

**Interfaces:**
- Produces:
  - `public enum DayTitle: Equatable, Sendable { case today, yesterday, date(Date) }`
  - `public struct DayGroup<Item> { public let start: Date; public let title: DayTitle; public var items: [Item] }`
  - `public func groupByDay<Item>(_ items: [Item], date: (Item) -> Date, now: Date, calendar: Calendar = .current) -> [DayGroup<Item>]`. It keeps input order, merges only adjacent items on the same calendar day, and `start` is `calendar.startOfDay`.

- [ ] **Step 1: Write the failing tests**

```swift
import Foundation
import Testing
@testable import TranscriberCore

struct HistoryGroupingTests {
    var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Jerusalem")!
        return c
    }()

    func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int = 0) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    @Test func emptyInputGivesNoGroups() {
        let groups = groupByDay([Date](), date: { $0 }, now: at(2026, 11, 27, 12), calendar: cal)
        #expect(groups.isEmpty)
    }

    @Test func labelsTodayYesterdayAndOlder() {
        let now = at(2026, 11, 27, 12)
        let items = [at(2026, 11, 27, 9), at(2026, 11, 26, 18), at(2026, 11, 20, 8)]
        let groups = groupByDay(items, date: { $0 }, now: now, calendar: cal)
        #expect(groups.map(\.title) == [.today, .yesterday, .date(at(2026, 11, 20, 0))])
        #expect(groups.map(\.items.count) == [1, 1, 1])
    }

    @Test func midnightBoundaries() {
        let now = at(2026, 11, 27, 0, 5)
        let items = [at(2026, 11, 27, 0, 0), at(2026, 11, 26, 23, 59), at(2026, 11, 26, 0, 0), at(2026, 11, 25, 23, 59)]
        let groups = groupByDay(items, date: { $0 }, now: now, calendar: cal)
        #expect(groups.map(\.title) == [.today, .yesterday, .date(at(2026, 11, 25, 0))])
        #expect(groups.map(\.items.count) == [1, 2, 1])
    }

    @Test func keepsOrderWithinAndAcrossGroups() {
        let now = at(2026, 11, 27, 12)
        let items = [at(2026, 11, 27, 11), at(2026, 11, 27, 9), at(2026, 11, 26, 20), at(2026, 11, 26, 7)]
        let groups = groupByDay(items, date: { $0 }, now: now, calendar: cal)
        #expect(groups.flatMap(\.items) == items)
        #expect(groups[0].start == at(2026, 11, 27, 0))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ios/TranscriberCore && swift test --filter HistoryGroupingTests`
Expected: compile failure, "cannot find 'groupByDay' in scope".

- [ ] **Step 3: Implement**

```swift
import Foundation

public enum DayTitle: Equatable, Sendable {
    case today, yesterday, date(Date)
}

public struct DayGroup<Item> {
    public let start: Date
    public let title: DayTitle
    public var items: [Item]
}

public func groupByDay<Item>(_ items: [Item], date: (Item) -> Date, now: Date,
                             calendar: Calendar = .current) -> [DayGroup<Item>] {
    let today = calendar.startOfDay(for: now)
    let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!
    var groups: [DayGroup<Item>] = []
    for item in items {
        let start = calendar.startOfDay(for: date(item))
        if let last = groups.indices.last, groups[last].start == start {
            groups[last].items.append(item)
        } else {
            let title: DayTitle = start == today ? .today : start == yesterday ? .yesterday : .date(start)
            groups.append(DayGroup(start: start, title: title, items: [item]))
        }
    }
    return groups
}
```

- [ ] **Step 4: Run all Core tests**

Run: `cd ios/TranscriberCore && swift test`
Expected: all tests pass, including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add ios/TranscriberCore/Sources/TranscriberCore/HistoryGrouping.swift ios/TranscriberCore/Tests/TranscriberCoreTests/HistoryGroupingTests.swift
git commit -m "feat(ios): group notes by day for History

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Recording duration and copied state in the model

**Files:**
- Modify: `ios/Transcriber/History/Note.swift`
- Modify: `ios/Transcriber/History/HistoryStore.swift` (the `upsert` field assignments near line 170, and `text(of:)` near line 228)
- Modify: `ios/Transcriber/AppModel.swift`

**Interfaces:**
- Produces (used by Tasks 4–7):
  - `NoteSnapshot.durationSeconds: Double?`, declared **last** with default `nil`, so existing memberwise calls compile.
  - `Note.durationSeconds: Double?`
  - `AppModel.recordedDuration: TimeInterval?` (`private(set)`)
  - `AppModel.isCopied: Bool`, true while the last text the app wrote to the pasteboard equals `currentText`.

- [ ] **Step 1: Add the field to `Note`**

In `Note.swift`, after `var pendingAudioFile: String?` add:

```swift
    var durationSeconds: Double?
```

A new optional attribute is a lightweight SwiftData migration, so no schema plan is needed.

- [ ] **Step 2: Add the field to `NoteSnapshot`**

In `AppModel.swift`, after `var pendingAudioFile: String?` in `struct NoteSnapshot`, add:

```swift
    var durationSeconds: Double? = nil
```

- [ ] **Step 3: Save and load it in `HistoryStore`**

In `upsert`, after `note.pendingAudioFile = s.pendingAudioFile` add:

```swift
        note.durationSeconds = s.durationSeconds
```

In `text(of:)`, change the end of the `NoteSnapshot(...)` call from

```swift
                                    pendingAudioFile: note.pendingAudioFile)
```

to

```swift
                                    pendingAudioFile: note.pendingAudioFile, durationSeconds: note.durationSeconds)
```

- [ ] **Step 4: Track duration and copied text in `AppModel`**

Add the stored properties next to `var toast: String?`:

```swift
    private(set) var recordedDuration: TimeInterval?
    private var copiedText: String?
```

Add the computed property below `var currentText`:

```swift
    // Derived rather than flagged: any edit or refine changes currentText, which clears it automatically.
    var isCopied: Bool { copiedText != nil && copiedText == currentText }
```

Change `beginNote` to take the duration:

```swift
    private func beginNote(id: UUID, createdAt: Date, audioFile: String, duration: TimeInterval?) {
        cancelInFlight()
        openAIKey = settings.key(for: .openai)
        cleanupStep = settings.cleanupStep()
        cost = CostMeter(); costText = nil; chips = []; chipsError = nil; refineError = nil
        recordedDuration = duration
        copiedText = nil
        note = NoteSnapshot(id: id, createdAt: createdAt, status: .transcriptionFailed, pendingAudioFile: audioFile,
                            durationSeconds: duration)
    }
```

Update both callers:

```swift
    // in recordingFinished
        beginNote(id: UUID(), createdAt: .now, audioFile: url.lastPathComponent, duration: elapsed)
```

```swift
    // in retry(_:)
        beginNote(id: snapshot.id, createdAt: snapshot.createdAt, audioFile: file, duration: snapshot.durationSeconds)
```

In `writePasteboard`, record the text:

```swift
    private func writePasteboard(_ text: String) {
        UIPasteboard.general.setItems([["public.utf8-plain-text": text]], options: [.localOnly: true])
        ownPasteboardCount = UIPasteboard.general.changeCount
        copiedText = text
    }
```

In `reset()`, extend the last line:

```swift
        note = nil; chips = []; chipsError = nil; refineError = nil; costText = nil
        recordedDuration = nil; copiedText = nil
```

- [ ] **Step 5: Build**

Run: `cd ios && xcodegen generate && xcodebuild -project Transcriber.xcodeproj -scheme Transcriber -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -3`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 6: Commit**

```bash
git add ios/Transcriber/History/Note.swift ios/Transcriber/History/HistoryStore.swift ios/Transcriber/AppModel.swift
git commit -m "feat(ios): store recording duration and track copied text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared style, app background, toolbar and Interrupted screen

**Files:**
- Create: `ios/Transcriber/Views/Style.swift`
- Modify: `ios/Transcriber/Views/ContentView.swift`

**Interfaces:**
- Produces (used by Tasks 4–7):
  - `View.card(padding: CGFloat = 14) -> some View`
  - `PrimaryButtonStyle()`, `IconButtonStyle()`, `ChipButtonStyle()`, all `ButtonStyle`
  - `MetaRow(leading: Text, trailing: Text)`, a `View`
  - `formatDuration(_ seconds: TimeInterval) -> String` (`"0:12"`, `"4:48"`)

- [ ] **Step 1: Create `Style.swift`**

```swift
import SwiftUI

extension View {
    func card(padding: CGFloat = 14) -> some View {
        self.padding(padding)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .opacity(configuration.isPressed || !isEnabled ? 0.6 : 1)
    }
}

// 48pt rather than 44 so it lines up with PrimaryButtonStyle in the Result bottom bar.
struct IconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(.iconOnly)
            .font(.body.weight(.medium))
            .foregroundStyle(Color.accentColor)
            .frame(width: 48, height: 48)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

struct ChipButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline)
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
            .overlay(Capsule().strokeBorder(Color(.separator)))
            .opacity(configuration.isPressed ? 0.6 : isEnabled ? 1 : 0.4)
    }
}

struct MetaRow: View {
    var leading = Text("")
    var trailing = Text("")
    var body: some View {
        HStack {
            leading
            Spacer()
            trailing
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .environment(\.layoutDirection, .leftToRight)
        .padding(.horizontal, 4)
    }
}

func formatDuration(_ seconds: TimeInterval) -> String {
    Duration.seconds(seconds.rounded()).formatted(.time(pattern: .minuteSecond))
}
```

- [ ] **Step 2: Update `ContentView`**

Replace the whole file with:

```swift
import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false
    @State private var showHistory = false

    var body: some View {
        NavigationStack {
            Group {
                switch model.state.phase {
                case .idle: IdleView()
                case .recording: RecordingView()
                case .transcribing, .cleaning: ProcessingView()
                case .result: ResultView()
                case .interrupted: InterruptedView()
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .toolbar {
                if model.state.phase == .idle {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("History", systemImage: "clock") { showHistory = true }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
                    }
                }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView(settings: model.settings) }
        .sheet(isPresented: $showHistory) { HistoryView() }
        .overlay(alignment: .top) {
            if let toast = model.toast {
                Text(toast).padding(.horizontal, 16).padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule()).padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: model.toast)
        .onChange(of: model.state.phase) { _, phase in if phase != .idle { showHistory = false } }
    }
}

private struct InterruptedView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            VStack(spacing: 8) {
                Image(systemName: "pause.circle.fill").font(.largeTitle).foregroundStyle(.orange)
                Text("Recording was interrupted").font(.headline)
                Text("The audio up to the interruption was kept.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .card(padding: 20)
            Button("Transcribe it") { model.transcribeInterrupted() }.buttonStyle(PrimaryButtonStyle())
            Button("Discard", role: .destructive) { model.reset() }
            Spacer()
        }
    }
}
```

- [ ] **Step 3: Build**

Run the app build command. Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add ios/Transcriber/Views/Style.swift ios/Transcriber/Views/ContentView.swift
git commit -m "feat(ios): shared style, grouped background, restyled interrupted screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Idle and Recording screens

**Files:**
- Modify: `ios/Transcriber/Views/IdleView.swift` (replace)
- Modify: `ios/Transcriber/Views/RecordingView.swift` (replace)

**Interfaces:**
- Consumes: `card()`, `formatDuration` (Task 3), `Recorder.maxDuration` (existing, `TimeInterval` 300), `AppModel.elapsed`, `levels`, `silentStyle`, `banner`, `micDenied`, `settings.hasOpenAIKey`.

- [ ] **Step 1: Replace `IdleView.swift`**

```swift
import SwiftUI

struct IdleView: View {
    @Environment(AppModel.self) private var model

    private var canRecord: Bool { model.settings.hasOpenAIKey }

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Button {
                Task { await model.startRecording() }
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 44, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 112, height: 112)
                    .background(Circle().fill(canRecord ? Color.accentColor : Color(.systemGray3)))
                    .shadow(color: canRecord ? Color.accentColor.opacity(0.35) : .clear, radius: 15, y: 8)
            }
            .buttonStyle(.plain)
            .disabled(!canRecord)
            .accessibilityLabel("Record")
            if canRecord {
                Text("Tap to record\nUp to 5 minutes")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            } else {
                Text("Add your OpenAI key in Settings to start.")
                    .font(.subheadline).foregroundStyle(.secondary).card()
            }
            if let banner = model.banner {
                VStack(spacing: 10) {
                    Text(banner).foregroundStyle(.red).multilineTextAlignment(.center)
                    if model.micDenied, let url = URL(string: UIApplication.openSettingsURLString) {
                        Button("Open Settings") { UIApplication.shared.open(url) }
                    }
                }
                .frame(maxWidth: .infinity)
                .card()
            }
            Spacer()
        }
    }
}
```

- [ ] **Step 2: Replace `RecordingView.swift`**

```swift
import SwiftUI

struct RecordingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Text("● REC").font(.caption.weight(.semibold)).foregroundStyle(.red)
            Text(formatDuration(model.elapsed))
                .font(.system(size: 44, weight: .light)).monospacedDigit()
            HStack(alignment: .center, spacing: 3) {
                ForEach(Array(model.levels.enumerated()), id: \.offset) { _, level in
                    Capsule().frame(width: 4, height: max(4, level * 70))
                }
            }
            .frame(height: 70)
            .foregroundStyle(model.silentStyle ? Color.secondary : Color.accentColor)
            Text("\(formatDuration(max(0, Recorder.maxDuration - model.elapsed))) left")
                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            Spacer()
            Button { model.stopRecording() } label: {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(.red)
                    .frame(width: 28, height: 28)
                    .frame(width: 84, height: 84)
                    .background(Circle().fill(Color(.secondarySystemGroupedBackground)))
                    .shadow(color: .black.opacity(0.08), radius: 8, y: 3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop recording")
            .padding(.bottom, 24)
        }
    }
}
```

- [ ] **Step 3: Build**

Run the app build command. Expected: `** BUILD SUCCEEDED **`. If `Recorder.maxDuration` is not visible (it's `static let` on an internal class in the same target, so it should be), report it rather than duplicating the 300.

- [ ] **Step 4: Commit**

```bash
git add ios/Transcriber/Views/IdleView.swift ios/Transcriber/Views/RecordingView.swift
git commit -m "feat(ios): restyle idle and recording screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Processing screen as a step list

**Files:**
- Modify: `ios/Transcriber/Views/ProcessingView.swift` (replace)

**Interfaces:**
- Consumes: `card()`, `PrimaryButtonStyle`, `formatDuration` (Task 3), `AppModel.recordedDuration` (Task 2), `state.phase`, `state.error`, `retryTranscription()`, `reset()`.

- [ ] **Step 1: Replace `ProcessingView.swift`**

```swift
import SwiftUI

struct ProcessingView: View {
    @Environment(AppModel.self) private var model

    private var transcribeFailed: Bool { model.state.error != nil && model.state.phase == .transcribing }

    private var recordedTitle: String {
        model.recordedDuration.map { "Recorded · \(formatDuration($0))" } ?? "Recorded"
    }

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            VStack(spacing: 0) {
                StepRow(title: recordedTitle, state: .done)
                Divider()
                StepRow(title: "Transcribing", state: transcribeFailed ? .failed
                        : model.state.phase == .transcribing ? .active : .done)
                Divider()
                StepRow(title: "Cleaning up", state: model.state.phase == .cleaning ? .active : .pending)
            }
            .padding(.horizontal, 14).padding(.vertical, 4)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if transcribeFailed, let error = model.state.error {
                Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                Button("Retry") { model.retryTranscription() }.buttonStyle(PrimaryButtonStyle())
                Button("Later") { model.reset() }
                Text("The recording is saved in History, so you can retry later.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            } else {
                Text("You can leave the app.\nThe result will be copied.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Spacer()
        }
    }
}

private enum StepState { case done, active, pending, failed }

private struct StepRow: View {
    let title: String
    let state: StepState

    var body: some View {
        HStack(spacing: 12) {
            icon.frame(width: 22, height: 22)
            Text(title)
                .fontWeight(state == .active ? .semibold : .regular)
                .foregroundStyle(state == .pending ? .secondary : .primary)
            Spacer()
        }
        .padding(.vertical, 12)
    }

    @ViewBuilder private var icon: some View {
        switch state {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .active: ProgressView().controlSize(.small)
        case .pending: Image(systemName: "circle").foregroundStyle(.tertiary)
        case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        }
    }
}
```

- [ ] **Step 2: Build**

Run the app build command. Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add ios/Transcriber/Views/ProcessingView.swift
git commit -m "feat(ios): show processing as a step list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Result screen

**Files:**
- Modify: `ios/Transcriber/Views/ResultView.swift` (replace)

**Interfaces:**
- Consumes: `card()`, `PrimaryButtonStyle`, `IconButtonStyle`, `ChipButtonStyle`, `MetaRow`, `formatDuration` (Task 3), `AppModel.isCopied`, `recordedDuration` (Task 2), and the existing `currentText`, `costText`, `chips`, `applyChip`, `isRefining`, `refineError`, `chipsError`, `copyCurrent()`, `commitEdit(_:)`, `retryCleanup()`, `reset()`, `state.language`, `state.error`.

- [ ] **Step 1: Replace `ResultView.swift`**

```swift
import SwiftUI
import TranscriberCore

struct ResultView: View {
    @Environment(AppModel.self) private var model
    @State private var draft = ""
    @FocusState private var editing: Bool

    private var direction: LayoutDirection { model.state.language == .he ? .rightToLeft : .leftToRight }

    private var headerText: String {
        model.recordedDuration.map { "Just now · \(formatDuration($0))" } ?? "Just now"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MetaRow(leading: Text(headerText),
                    trailing: model.isCopied ? Text("✓ Copied").foregroundStyle(.green) : Text(""))
            if let error = model.state.error {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Cleanup failed — showing the raw transcript. \(error)").font(.footnote)
                    Button("Retry cleanup") { model.retryCleanup() }.font(.footnote.weight(.semibold))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            // A vertical TextField grows with its text (TextEditor always fills the space it's given).
            TextField("", text: $draft, axis: .vertical)
                .lineLimit(2...14)
                .font(.body)
                .focused($editing)
                .environment(\.layoutDirection, direction)
                .card()
            MetaRow(leading: Text("Tap text to edit"), trailing: Text(model.costText ?? ""))
            if model.isRefining { ProgressView("Refining…").font(.footnote) }
            if let e = model.refineError ?? model.chipsError { Text(e).font(.footnote).foregroundStyle(.red) }
            if !model.chips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.chips) { chip in
                            Button(chip.label) { Task { await model.applyChip(chip) } }
                                .buttonStyle(ChipButtonStyle())
                                .disabled(model.isRefining)
                        }
                    }
                }
                // On the scroll view itself so a Hebrew row starts at the right edge.
                .environment(\.layoutDirection, direction)
                .scrollClipDisabled()
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                ShareLink(item: model.currentText) { Label("Share", systemImage: "square.and.arrow.up") }
                    .buttonStyle(IconButtonStyle())
                Button(model.isCopied ? "Copy again" : "Copy") { commitDraft(); model.copyCurrent() }
                    .buttonStyle(PrimaryButtonStyle())
                Button { model.reset() } label: { Label("New note", systemImage: "plus") }
                    .buttonStyle(IconButtonStyle())
            }
        }
        .onAppear { draft = model.currentText }
        .onChange(of: model.currentText) { _, text in if !editing { draft = text } }
        .onChange(of: editing) { _, isEditing in if !isEditing { commitDraft() } }
        .toolbar {
            if editing { ToolbarItem(placement: .keyboard) { Button("Done") { editing = false } } }
        }
    }

    private func commitDraft() {
        if draft != model.currentText { model.commitEdit(draft) }
    }
}
```

- [ ] **Step 2: Build**

Run the app build command. Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add ios/Transcriber/Views/ResultView.swift
git commit -m "feat(ios): compact result card, RTL chips, copied state and clear primary action

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: History and Note detail

**Files:**
- Modify: `ios/Transcriber/Views/HistoryView.swift`
- Modify: `ios/Transcriber/Views/NoteDetailView.swift` (replace)

**Interfaces:**
- Consumes: `groupByDay`, `DayTitle`, `DayGroup` (Task 1, from `TranscriberCore`), `Note.durationSeconds` / `NoteSnapshot.durationSeconds` (Task 2), `card()`, `PrimaryButtonStyle`, `IconButtonStyle`, `MetaRow`, `formatDuration` (Task 3).

- [ ] **Step 1: Import Core and restyle the lock screen**

At the top of `HistoryView.swift`, add `import TranscriberCore` after `import SwiftUI`. Replace the locked `VStack` branch in `HistoryView.body` with:

```swift
                VStack(spacing: 16) {
                    VStack(spacing: 12) {
                        Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
                        Text("History is locked").font(.headline)
                        if let e = lock.error { Text(e).font(.footnote).foregroundStyle(.red) }
                    }
                    .frame(maxWidth: .infinity)
                    .card(padding: 24)
                    Button("Unlock") { Task { await lock.unlock() } }.buttonStyle(PrimaryButtonStyle())
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemGroupedBackground).ignoresSafeArea())
                .task { await lock.unlock() }
```

- [ ] **Step 2: Group the list by day**

In `HistoryList.body`, replace the `ForEach(notes) { … }.onDelete { … }` block with:

```swift
                ForEach(groupByDay(notes, date: { $0.createdAt }, now: .now), id: \.start) { group in
                    Section(dayTitle(group.title)) {
                        ForEach(group.items) { note in
                            let d = store.text(of: note)
                            if d.readable {
                                NavigationLink { NoteDetailView(note: d) } label: { NoteRow(note: d) }
                            } else {
                                NoteRow(note: d)
                            }
                        }
                        .onDelete { $0.map { group.items[$0] }.forEach(store.delete) }
                    }
                }
```

After `List { … }` add `.listStyle(.insetGrouped)`. Add this method inside `HistoryList`:

```swift
    private func dayTitle(_ title: DayTitle) -> String {
        switch title {
        case .today: "Today"
        case .yesterday: "Yesterday"
        case .date(let day): day.formatted(.dateTime.weekday(.wide).day().month())
        }
    }
```

- [ ] **Step 3: Add duration to the row**

Replace `NoteRow` with:

```swift
private struct NoteRow: View {
    let note: DecryptedNote
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(note.readable ? note.bestText : (note.locked ? "Locked" : "Can't be read")).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .environment(\.layoutDirection, note.snapshot.language == .he ? .rightToLeft : .leftToRight)
            HStack(spacing: 4) {
                Text(note.snapshot.createdAt, format: .dateTime.hour().minute())
                if let seconds = note.snapshot.durationSeconds { Text("· \(formatDuration(seconds))") }
                if note.snapshot.status == .transcriptionFailed { Text("· Not transcribed").foregroundStyle(.orange) }
                if note.snapshot.status == .cleanupFailed { Text("· Raw only").foregroundStyle(.orange) }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
```

- [ ] **Step 4: Replace `NoteDetailView.swift`**

```swift
import SwiftUI

struct NoteDetailView: View {
    let note: DecryptedNote
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private var meta: String {
        var parts = [note.snapshot.createdAt.formatted(.dateTime.day().month().hour().minute())]
        if let seconds = note.snapshot.durationSeconds { parts.append(formatDuration(seconds)) }
        if let cost = note.snapshot.costUsd { parts.append(Pricing.format(cost)) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MetaRow(leading: Text(meta))
                if note.snapshot.status == .transcriptionFailed {
                    Text("This recording wasn't transcribed.")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .card()
                    Button("Retry transcription") {
                        model.retry(note.snapshot)
                        dismiss()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    Text(note.bestText).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .environment(\.layoutDirection, note.snapshot.language == .he ? .rightToLeft : .leftToRight)
                        .card()
                    HStack(spacing: 10) {
                        ShareLink(item: note.bestText) { Label("Share", systemImage: "square.and.arrow.up") }
                            .buttonStyle(IconButtonStyle())
                        Button("Copy") { model.copy(note.bestText) }.buttonStyle(PrimaryButtonStyle())
                    }
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle("Note")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if note.readable, note.snapshot.status != .transcriptionFailed, !note.bestText.isEmpty { model.copy(note.bestText) }
        }
    }
}
```

`Pricing.format` lives in `TranscriberCore`. If the build reports it missing, add `import TranscriberCore` at the top of the file.

- [ ] **Step 5: Build**

Run the app build command. Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 6: Commit**

```bash
git add ios/Transcriber/Views/HistoryView.swift ios/Transcriber/Views/NoteDetailView.swift
git commit -m "feat(ios): history grouped by day with durations, restyled note detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verify in the Simulator

**Files:** none (verification only; fix in the relevant view if something is off, then commit that fix).

- [ ] **Step 1: Run all Core tests**

Run: `cd ios/TranscriberCore && swift test`
Expected: all pass.

- [ ] **Step 2: Build and launch on a simulator**

Use the iOS Simulator tool: `attach` (iPhone 18 Pro is booted on this Mac), then build for that simulator and `launch` the `.app`:

```bash
cd ios && xcodebuild -project Transcriber.xcodeproj -scheme Transcriber -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build build 2>&1 | tail -3
```

The app is at `ios/build/Build/Products/Debug-iphonesimulator/Transcriber.app`.

- [ ] **Step 3: Screenshot each screen in light and dark mode**

The simulator has no OpenAI key or real voice, so check what is reachable without the network and note the rest:

- Idle without a key (the disabled mic and key hint card), then with a key entered in Settings.
- Recording: tap the mic, speak or stay silent for a few seconds, check the REC mark, the countdown and the stop button.
- Processing: right after stopping. With a dummy key, transcription fails, which shows the failed-step state with Retry and Later.
- History: Today section, the duration on the row, "Not transcribed" in orange. Open the row for Note detail.
- Switch appearance with `set_appearance dark` and repeat the Idle, Recording and History screenshots.

The Result screen needs a successful transcription. If no real OpenAI key is available in the simulator, say so in the report and leave the Result check (compact card, RTL chips, "✓ Copied" clearing after a refine) for the next TestFlight build on device.

- [ ] **Step 4: Report**

Send the screenshots to the user and list anything that looked wrong and was fixed, plus anything not verified.
