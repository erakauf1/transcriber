import Foundation
import Testing
@testable import TranscriberCore

struct LockPolicyTests {
    let t0 = Date(timeIntervalSince1970: 0)
    @Test func relocksOnlyAfterGrace() {
        #expect(!LockPolicy.shouldRelock(backgroundedAt: nil, now: t0))
        #expect(!LockPolicy.shouldRelock(backgroundedAt: t0, now: t0.addingTimeInterval(60)))
        #expect(LockPolicy.shouldRelock(backgroundedAt: t0, now: t0.addingTimeInterval(60.5)))
    }
}
