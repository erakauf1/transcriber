import Testing
@testable import TranscriberCore

struct CostMeterTests {
    @Test func sumsKnownCosts() {
        let m = CostMeter()
        #expect(m.total == nil)
        m.add(.cleanup, 0.01); m.add(.cleanup, nil); m.add(.refine, 0.02)
        #expect(abs(m.total! - 0.03) < 1e-12)
        m.reset()
        #expect(m.total == nil)
    }
}
