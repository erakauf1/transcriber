import Testing
@testable import TranscriberCore

struct PricingTests {
    @Test func labels() {
        #expect(Pricing.label("claude-sonnet-5") == "Claude Sonnet 5")
        #expect(Pricing.label("some/unknown") == "some/unknown")
    }
    @Test func estimate() {
        #expect(Pricing.estimateCost(model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0, reportedCost: nil) == 2)
        #expect(Pricing.estimateCost(model: "gpt-4o", inputTokens: 0, outputTokens: 1_000_000, reportedCost: nil) == 10)
        #expect(Pricing.estimateCost(model: "x", inputTokens: 5, outputTokens: 5, reportedCost: nil) == nil)
        #expect(Pricing.estimateCost(model: "x", inputTokens: 5, outputTokens: 5, reportedCost: 0.5) == 0.5)
    }
    @Test func format() {
        #expect(Pricing.format(0) == "$0")
        #expect(Pricing.format(0.00001) == "< $0.0001")
        #expect(Pricing.format(0.0042) == "$0.0042")
        #expect(Pricing.format(0.125) == "$0.125")
    }
}
