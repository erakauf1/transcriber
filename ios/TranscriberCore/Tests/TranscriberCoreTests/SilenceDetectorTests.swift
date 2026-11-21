import Foundation
import Testing
@testable import TranscriberCore

struct SilenceDetectorTests {
    let t0 = Date(timeIntervalSince1970: 0)

    @Test func needsTwoLoudFramesToStart() {
        var d = SilenceDetector()
        #expect(d.update(peak: 0.2, now: t0) == nil)
        #expect(!d.speaking)
        #expect(d.update(peak: 0.2, now: t0) == .speechStart)
        #expect(d.speaking)
        #expect(d.update(peak: 0.2, now: t0) == nil)
    }

    @Test func singleSpikeDoesNotStart() {
        var d = SilenceDetector()
        _ = d.update(peak: 0.2, now: t0)
        #expect(d.update(peak: 0.01, now: t0) == nil)
        #expect(d.update(peak: 0.2, now: t0) == nil)
    }

    @Test func endsAfterHangover() {
        var d = SilenceDetector()
        _ = d.update(peak: 0.2, now: t0); _ = d.update(peak: 0.2, now: t0)
        #expect(d.update(peak: 0.01, now: t0) == nil)
        #expect(d.update(peak: 0.01, now: t0.addingTimeInterval(0.5)) == nil)
        #expect(d.update(peak: 0.01, now: t0.addingTimeInterval(0.81)) == .speechEnd)
    }

    @Test func loudFrameResetsHangover() {
        var d = SilenceDetector()
        _ = d.update(peak: 0.2, now: t0); _ = d.update(peak: 0.2, now: t0)
        _ = d.update(peak: 0.01, now: t0)
        _ = d.update(peak: 0.2, now: t0.addingTimeInterval(0.5))
        #expect(d.update(peak: 0.01, now: t0.addingTimeInterval(0.9)) == nil)
    }
}
