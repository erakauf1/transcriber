import Foundation

public enum Pricing {
    struct Price: Sendable { let label: String; let input: Double; let output: Double }

    // USD per million tokens. Keep in sync with src/pricing.js.
    static let models: [String: Price] = [
        "claude-sonnet-5": Price(label: "Claude Sonnet 5", input: 2, output: 10),
        "claude-sonnet-5-5": Price(label: "Claude Sonnet 5.5", input: 2, output: 10),
        "claude-haiku-5-5": Price(label: "Claude Haiku 5.5", input: 0.1, output: 0.5),
        "claude-opus-5-5": Price(label: "Claude Opus 5.5", input: 4, output: 20),
        "gpt-4o": Price(label: "GPT-4o", input: 2.5, output: 10),
    ]

    public static func label(_ model: String) -> String { models[model]?.label ?? model }

    public static func estimateCost(model: String, inputTokens: Int, outputTokens: Int, reportedCost: Double?) -> Double? {
        if let reportedCost { return reportedCost }
        guard let p = models[model] else { return nil }
        return (Double(inputTokens) * p.input + Double(outputTokens) * p.output) / 1e6
    }

    public static func format(_ usd: Double) -> String {
        if usd == 0 { return "$0" }
        if usd < 0.0001 { return "< $0.0001" }
        return String(format: usd < 0.01 ? "$%.4f" : "$%.3f", usd)
    }
}
