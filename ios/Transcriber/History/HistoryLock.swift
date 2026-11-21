import Foundation
import LocalAuthentication
import Observation
import TranscriberCore

@MainActor @Observable
final class HistoryLock {
    private(set) var isUnlocked = false
    private(set) var error: String?
    @ObservationIgnored private var backgroundedAt: Date?

    func unlock() async {
        let context = LAContext()
        do {
            isUnlocked = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your note history")
            error = nil
        } catch {
            isUnlocked = false
            self.error = (error as? LAError)?.code == .userCancel ? nil : error.localizedDescription
        }
    }

    func lock() { isUnlocked = false }

    func didEnterBackground() { backgroundedAt = .now }

    func didBecomeActive() {
        if LockPolicy.shouldRelock(backgroundedAt: backgroundedAt, now: .now) { lock() }
        backgroundedAt = nil
    }
}
