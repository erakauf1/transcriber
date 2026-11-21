import Observation
import SwiftUI
import TranscriberCore

enum NoteStatus: String, Codable { case done, transcriptionFailed, cleanupFailed }

struct NoteSnapshot {
    let id: UUID
    let createdAt: Date
    var rawTranscript: String?
    var cleanedText: String?
    var language: Language?
    var provider: Provider?
    var model: String?
    var costUsd: Double?
    var status: NoteStatus
    var pendingAudioFile: String?
}

@MainActor @Observable
final class AppModel {
    private(set) var state = AppState()
    let settings: Settings
    var elapsed: TimeInterval = 0
    var levels: [Double] = Array(repeating: 0, count: 24)
    var silentStyle = false
    var chips: [RefineChip] = []
    var chipsError: String?
    var isRefining = false
    var refineError: String?
    var costText: String?
    var banner: String?
    var toast: String?

    @ObservationIgnored var onNoteChanged: (NoteSnapshot) -> Void = { _ in }
    @ObservationIgnored private let recorder = Recorder()
    @ObservationIgnored private let client = LLMClient()
    @ObservationIgnored private let transcriber = Transcriber()
    // Replaced per note: usage callbacks from stale work still hold the old meter and can't pollute the new note's total.
    @ObservationIgnored private var cost = CostMeter()
    @ObservationIgnored private var note: NoteSnapshot?
    @ObservationIgnored private var pendingCopy: String?
    // Captured when recording stops: the Keychain can't be read once the phone locks.
    @ObservationIgnored private var openAIKey = ""
    @ObservationIgnored private var cleanupStep: StepConfig?
    @ObservationIgnored private var pipeline: Task<Void, Never>?
    // Bumped on every new note and reset: results from an older note's in-flight work must not touch the current one.
    @ObservationIgnored private var generation = 0

    init(settings: Settings) {
        self.settings = settings
        recorder.onTick = { [weak self] in self?.elapsed = $0 }
        recorder.onLevel = { [weak self] level in
            guard let self else { return }
            levels.removeFirst(); levels.append(min(1, level))
        }
        recorder.onVAD = { [weak self] in self?.silentStyle = ($0 == .speechEnd) }
        recorder.onFinish = { [weak self] url, reason in self?.recordingFinished(url, reason) }
    }

    var currentText: String { state.cleanedText ?? state.rawTranscript ?? "" }

    private func dispatch(_ event: AppEvent) { state = reduce(state, event) }

    // MARK: Recording

    func startRecording() async {
        guard state.phase == .idle, !recorder.isRecording else { return }
        guard await Recorder.requestPermission() else {
            banner = "Microphone access is off. Turn it on in Settings → Transcriber."
            return
        }
        do {
            try recorder.start()
            banner = nil; elapsed = 0; silentStyle = false
            levels = Array(repeating: 0, count: 24)
            dispatch(.recordStart)
        } catch {
            banner = error.localizedDescription
        }
    }

    func stopRecording() { recorder.stop() }

    private func recordingFinished(_ url: URL, _ reason: Recorder.FinishReason) {
        beginNote(id: UUID(), createdAt: .now)
        if reason == .interrupted {
            dispatch(.recordInterrupted(url))
        } else {
            dispatch(.recordStop(url))
            runPipeline()
        }
    }

    func transcribeInterrupted() {
        dispatch(.interruptedTranscribe)
        runPipeline()
    }

    /// Re-runs a saved note whose transcription failed (from History).
    func retry(_ snapshot: NoteSnapshot) {
        guard state.phase == .idle || state.phase == .result, let file = snapshot.pendingAudioFile else { return }
        dispatch(.reset)
        beginNote(id: snapshot.id, createdAt: snapshot.createdAt)
        dispatch(.recordStop(AudioFiles.url(named: file)))
        runPipeline()
    }

    private func beginNote(id: UUID, createdAt: Date) {
        cancelInFlight()
        openAIKey = settings.key(for: .openai)
        cleanupStep = settings.cleanupStep()
        cost = CostMeter(); costText = nil; chips = []; chipsError = nil; refineError = nil
        note = NoteSnapshot(id: id, createdAt: createdAt, status: .transcriptionFailed)
    }

    // MARK: Pipeline

    private func runPipeline() {
        let task = BackgroundTask.begin("transcribe")
        pipeline = Task {
            defer { task.end() }
            await transcribeStep()
            guard !Task.isCancelled else { return }
            if state.phase == .cleaning { await cleanupStepRun() }
        }
    }

    func retryTranscription() {
        dispatch(.transcribeRetry)
        runPipeline()
    }

    func retryCleanup() {
        dispatch(.cleanupRetry)
        let task = BackgroundTask.begin("cleanup")
        pipeline = Task { defer { task.end() }; await cleanupStepRun() }
    }

    private func transcribeStep() async {
        guard let url = state.audioFile else { return }
        let gen = generation
        do {
            let text = try await transcriber.transcribe(fileURL: url, apiKey: openAIKey)
            guard !Task.isCancelled, gen == generation else { return }
            dispatch(.transcribeOK(text: text, language: detectLanguage(text)))
            try? FileManager.default.removeItem(at: url)
            note?.pendingAudioFile = nil
            note?.rawTranscript = text
            note?.language = state.language
        } catch {
            guard !Task.isCancelled, gen == generation else { return }
            dispatch(.transcribeFail(error.localizedDescription))
            note?.status = .transcriptionFailed
            note?.pendingAudioFile = url.lastPathComponent
            saveNote()
        }
    }

    private func cleanupStepRun() async {
        guard let raw = state.rawTranscript, let lang = state.language, let step = cleanupStep else { return }
        let gen = generation
        let usage: UsageHandler = { [cost] in cost.add(.cleanup, $0.costUsd) }
        note?.provider = step.provider; note?.model = step.model
        do {
            let withTerms = await EnglishTerms.restore(text: raw, language: lang, step: step, client: client, onUsage: usage)
            let cleaned = try await Cleanup.run(text: withTerms, language: lang, step: step, client: client, onUsage: usage)
            guard !Task.isCancelled, gen == generation else { return }
            dispatch(.cleanupOK(text: cleaned, autoCopied: autoCopy(cleaned)))
            note?.status = .done
            note?.cleanedText = cleaned
        } catch {
            guard !Task.isCancelled, gen == generation else { return }
            dispatch(.cleanupFail(message: error.localizedDescription, autoCopied: autoCopy(raw)))
            note?.status = .cleanupFailed
        }
        guard !Task.isCancelled, gen == generation else { return }
        updateCost()
        saveNote()
        if state.cleanedText != nil { await loadChips() }
    }

    private func saveNote() {
        guard var n = note else { return }
        n.costUsd = cost.total
        note = n
        onNoteChanged(n)
    }

    private func updateCost() { costText = cost.total.map { "Estimated cost: \(Pricing.format($0))" } }

    // MARK: Refine

    private func loadChips() async {
        let step = settings.refineStep()
        guard !step.apiKey.isEmpty, let lang = state.language, let text = state.cleanedText else { return }
        let gen = generation
        do {
            let result = try await Refine.chips(text: text, language: lang, step: step, client: client) { [cost] in cost.add(.refine, $0.costUsd) }
            guard !Task.isCancelled, gen == generation else { return }
            chips = result
            chipsError = nil
        } catch {
            guard !Task.isCancelled, gen == generation else { return }
            chipsError = error.localizedDescription
        }
        updateCost()
    }

    func applyChip(_ chip: RefineChip) async {
        let step = settings.refineStep()
        guard let lang = state.language, !isRefining else { return }
        let gen = generation
        isRefining = true; refineError = nil
        defer { if gen == generation { isRefining = false } }
        do {
            let text = try await Refine.apply(text: currentText, language: lang, instruction: chip.instruction,
                                              step: step, client: client) { [cost] in cost.add(.refine, $0.costUsd) }
            guard !Task.isCancelled, gen == generation else { return }
            dispatch(.refineOK(text))
            note?.cleanedText = text
            saveNote()
        } catch {
            guard !Task.isCancelled, gen == generation else { return }
            refineError = error.localizedDescription
        }
        updateCost()
    }

    func commitEdit(_ text: String) {
        let before = state
        dispatch(.editCommit(text))
        guard state != before else { return }
        note?.cleanedText = state.cleanedText
        note?.rawTranscript = state.rawTranscript
        saveNote()
    }

    // MARK: Clipboard

    // Written immediately even in the background so it can be pasted elsewhere right away;
    // written again on return in case iOS dropped the background write (checked on device in Task 13).
    private func autoCopy(_ text: String) -> Bool {
        UIPasteboard.general.string = text
        if UIApplication.shared.applicationState == .active { showToast("Copied") } else { pendingCopy = text }
        return true
    }

    func copyCurrent() {
        UIPasteboard.general.string = currentText
        showToast("Copied")
    }

    func copy(_ text: String) {
        UIPasteboard.general.string = text
        showToast("Copied")
    }

    private func showToast(_ text: String) {
        toast = text
        Task { try? await Task.sleep(for: .seconds(2)); if toast == text { toast = nil } }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        if phase == .active, let text = pendingCopy {
            pendingCopy = nil
            UIPasteboard.general.string = text
            showToast("Copied")
        }
    }

    private func cancelInFlight() {
        pipeline?.cancel(); pipeline = nil
        generation += 1
        isRefining = false
    }

    func reset() {
        cancelInFlight()
        if state.phase == .interrupted, let url = state.audioFile { try? FileManager.default.removeItem(at: url) }
        dispatch(.reset)
        note = nil; chips = []; chipsError = nil; refineError = nil; costText = nil
    }
}
