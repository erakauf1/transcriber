import Foundation

public enum Phase: Equatable, Sendable {
    case idle, recording, transcribing, cleaning, result, interrupted
}

public struct AppState: Equatable, Sendable {
    public var phase: Phase = .idle
    public var audioFile: URL?
    public var rawTranscript: String?
    public var language: Language?
    public var cleanedText: String?
    public var error: String?
    public var autoCopied = false

    public init() {}
}

public enum AppEvent: Sendable {
    case recordStart
    case recordStop(URL)
    case recordInterrupted(URL)
    case interruptedTranscribe
    case transcribeOK(text: String, language: Language)
    case transcribeFail(String)
    case transcribeRetry
    case cleanupOK(text: String, autoCopied: Bool)
    case cleanupFail(message: String, autoCopied: Bool)
    case cleanupRetry
    case refineOK(String)
    case editCommit(String)
    case reset
}

public func reduce(_ state: AppState, _ event: AppEvent) -> AppState {
    var s = state
    switch event {
    case .recordStart:
        s = AppState(); s.phase = .recording
    case .recordStop(let url):
        s.phase = .transcribing; s.audioFile = url; s.error = nil
    case .recordInterrupted(let url):
        s.phase = .interrupted; s.audioFile = url
    case .interruptedTranscribe:
        s.phase = .transcribing; s.error = nil
    case .transcribeOK(let text, let language):
        // Audio is released only now: a failed transcription must stay retryable.
        s.phase = .cleaning; s.rawTranscript = text; s.language = language; s.audioFile = nil; s.error = nil
    case .transcribeFail(let message):
        s.error = message
    case .transcribeRetry:
        s.error = nil
    case .cleanupOK(let text, let autoCopied):
        s.phase = .result; s.cleanedText = text; s.error = nil; s.autoCopied = autoCopied
    case .cleanupFail(let message, let autoCopied):
        s.phase = .result; s.cleanedText = nil; s.error = message; s.autoCopied = autoCopied
    case .cleanupRetry:
        s.phase = .cleaning; s.error = nil; s.autoCopied = false
    case .refineOK(let text):
        s.cleanedText = text
    case .editCommit(let text):
        guard s.phase == .result, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return state }
        // After a failed cleanup the editor shows the raw transcript, so that is what was edited.
        if s.cleanedText != nil { s.cleanedText = text } else { s.rawTranscript = text }
    case .reset:
        s = AppState()
    }
    return s
}
