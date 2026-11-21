import Foundation

public enum LockPolicy {
    public static func shouldRelock(backgroundedAt: Date?, now: Date, grace: TimeInterval = 60) -> Bool {
        guard let backgroundedAt else { return false }
        return now.timeIntervalSince(backgroundedAt) > grace
    }
}
