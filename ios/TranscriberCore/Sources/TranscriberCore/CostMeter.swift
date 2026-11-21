import Synchronization

public enum CostStep: Sendable { case cleanup, refine }

/// Usage callbacks arrive off the main actor; this keeps the per-note total consistent.
public final class CostMeter: Sendable {
    private let costs = Mutex<[Double]>([])

    public init() {}

    public func add(_ step: CostStep, _ usd: Double?) {
        guard let usd else { return }
        costs.withLock { $0.append(usd) }
    }

    public var total: Double? {
        costs.withLock { $0.isEmpty ? nil : $0.reduce(0, +) }
    }

    public func reset() { costs.withLock { $0.removeAll() } }
}
