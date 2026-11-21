import Foundation
import Testing
@testable import TranscriberCore

struct StateTests {
    let file = URL(fileURLWithPath: "/tmp/a.m4a")

    @Test func recordStartClearsEverything() {
        var s = AppState(); s.error = "x"; s.cleanedText = "y"
        let n = reduce(s, .recordStart)
        #expect(n.phase == .recording && n.error == nil && n.cleanedText == nil)
    }

    @Test func stopGoesToTranscribingWithAudio() {
        let n = reduce(reduce(AppState(), .recordStart), .recordStop(file))
        #expect(n.phase == .transcribing && n.audioFile == file)
    }

    @Test func interruptedKeepsAudioThenTranscribes() {
        let i = reduce(AppState(), .recordInterrupted(file))
        #expect(i.phase == .interrupted && i.audioFile == file)
        #expect(reduce(i, .interruptedTranscribe).phase == .transcribing)
    }

    @Test func failedTranscriptionKeepsAudioForRetry() {
        let s = reduce(reduce(AppState(), .recordStop(file)), .transcribeFail("boom"))
        #expect(s.phase == .transcribing && s.audioFile == file && s.error == "boom")
        #expect(reduce(s, .transcribeRetry).error == nil)
    }

    @Test func transcribeOKReleasesAudio() {
        let s = reduce(reduce(AppState(), .recordStop(file)), .transcribeOK(text: "hi", language: .en))
        #expect(s.phase == .cleaning && s.audioFile == nil && s.rawTranscript == "hi" && s.language == .en)
    }

    @Test func cleanupFailStillShowsResult() {
        let s = reduce(AppState(), .cleanupFail(message: "nope", autoCopied: true))
        #expect(s.phase == .result && s.cleanedText == nil && s.error == "nope" && s.autoCopied)
    }

    @Test func cleanupRetryResetsCopyFlag() {
        let s = reduce(reduce(AppState(), .cleanupOK(text: "c", autoCopied: true)), .cleanupRetry)
        #expect(s.phase == .cleaning && !s.autoCopied && s.error == nil)
    }

    @Test func editCommitTargetsCleanedOrRaw() {
        var s = AppState(); s.phase = .result; s.rawTranscript = "raw"
        #expect(reduce(s, .editCommit("fixed")).rawTranscript == "fixed")
        s.cleanedText = "clean"
        #expect(reduce(s, .editCommit("fixed")).cleanedText == "fixed")
        #expect(reduce(s, .editCommit("   ")) == s)
        var idle = AppState(); idle.cleanedText = "c"
        #expect(reduce(idle, .editCommit("x")) == idle)
    }

    @Test func refineAndReset() {
        var s = AppState(); s.phase = .result; s.cleanedText = "a"
        #expect(reduce(s, .refineOK("b")).cleanedText == "b")
        #expect(reduce(s, .reset) == AppState())
    }
}
