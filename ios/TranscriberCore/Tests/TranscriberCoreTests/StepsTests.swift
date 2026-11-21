import Testing
@testable import TranscriberCore

struct StepsTests {
    @Test func resolve() {
        #expect(resolveModel(provider: .openrouter, openRouterModel: "qwen/qwen3.7-flash", anthropicModel: "claude-opus-5-5") == "qwen/qwen3.7-flash")
        #expect(resolveModel(provider: .anthropic, openRouterModel: "x", anthropicModel: "claude-opus-5-5") == "claude-opus-5-5")
        #expect(resolveModel(provider: .openai, openRouterModel: "x", anthropicModel: "y") == "gpt-4o")
    }
    @Test func errorPrefix() {
        let e = ServiceError("Request failed: bad key").replacingPrefix("Request failed", with: "Cleanup failed")
        #expect(e.message == "Cleanup failed: bad key")
        #expect(ServiceError("Network error: x").replacingPrefix("Request failed", with: "Y").message == "Network error: x")
    }
}
