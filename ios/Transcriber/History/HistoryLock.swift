import Foundation
import LocalAuthentication
import Observation
import TranscriberCore

@MainActor @Observable
final class HistoryLock {
    private(set) var isUnlocked = false
    private(set) var error: String?
    private(set) var needsRelockCheck = false
    @ObservationIgnored private var backgroundedAt: Date?
    @ObservationIgnored private var context: LAContext?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var isEvaluating = false

    func unlock() async {
        guard !isEvaluating, !isUnlocked else { return }
        isEvaluating = true
        let ticket = generation
        let context = LAContext()
        self.context = context
        let granted: Bool
        var failure: Error?
        do {
            granted = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your note history")
        } catch {
            granted = false
            failure = error
        }
        // lock() ran while the prompt was up: evaluatePolicy ignores task cancellation, so a late success must not count.
        guard ticket == generation else { return }
        isEvaluating = false
        self.context = nil
        isUnlocked = granted
        error = (failure as? LAError)?.code == .userCancel ? nil : failure?.localizedDescription
    }

    func lock() {
        generation += 1
        context?.invalidate()
        context = nil
        isEvaluating = false
        isUnlocked = false
    }

    func didEnterBackground() {
        // Also called for .inactive: the app switcher holds the scene there without ever backgrounding it.
        // A Face ID prompt makes the scene inactive too, so don't start the clock while one is up.
        backgroundedAt = backgroundedAt ?? .now
        guard !isEvaluating else { return }
        needsRelockCheck = true
    }

    func didBecomeActive() {
        if LockPolicy.shouldRelock(backgroundedAt: backgroundedAt, now: .now) { lock() }
        backgroundedAt = nil
        needsRelockCheck = false
    }
}
