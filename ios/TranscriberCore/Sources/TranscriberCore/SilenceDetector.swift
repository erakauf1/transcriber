import Foundation

public enum VADEvent: Equatable, Sendable { case speechStart, speechEnd }

public struct SilenceDetector: Sendable {
    public let threshold: Double
    public let silence: TimeInterval
    public private(set) var speaking = false
    private var aboveCount = 0
    private var silenceSince: Date?

    public init(threshold: Double = 0.05, silence: TimeInterval = 0.8) {
        self.threshold = threshold; self.silence = silence
    }

    public mutating func update(peak: Double, now: Date) -> VADEvent? {
        if peak >= threshold {
            silenceSince = nil
            aboveCount += 1
            if !speaking && aboveCount >= 2 { speaking = true; return .speechStart }
            return nil
        }
        aboveCount = 0
        guard speaking else { return nil }
        guard let since = silenceSince else { silenceSince = now; return nil }
        if now.timeIntervalSince(since) >= silence {
            speaking = false; silenceSince = nil
            return .speechEnd
        }
        return nil
    }
}
