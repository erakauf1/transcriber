import Testing
@testable import TranscriberCore

/// fixtures/prompts.json is generated from the web app (`npm run prompts`); the Swift
/// prompts must match it exactly.
struct PromptParityTests {
    let step = StepConfig(provider: .anthropic, model: "claude-sonnet-5", apiKey: "k")

    func fixture() throws -> [String: Any] { try Fixtures.json("prompts.json") as! [String: Any] }

    func expected(_ f: [String: Any], _ group: String, _ lang: String? = nil) -> (String, [ChatMessage]) {
        var node = f[group] as! [String: Any]
        if let lang { node = node[lang] as! [String: Any] }
        let messages = (node["messages"] as! [[String: String]]).map { ChatMessage(role: $0["role"]!, content: $0["content"]!) }
        return (node["system"] as! String, messages)
    }

    @Test(arguments: Language.allCases) func cleanup(lang: Language) throws {
        let f = try fixture()
        let r = Cleanup.request(text: f["text"] as! String, language: lang, step: step)
        let (system, messages) = expected(f, "cleanup", lang.rawValue)
        #expect(r.systemPrompt == system)
        #expect(r.messages == messages)
        #expect(r.maxTokens == 4096 && r.timeout == 120 && r.temperature == nil)
    }

    @Test(arguments: Language.allCases) func refineChips(lang: Language) throws {
        let f = try fixture()
        let r = Refine.chipsRequest(text: f["text"] as! String, language: lang, step: step)
        let (system, messages) = expected(f, "refineChips", lang.rawValue)
        #expect(r.systemPrompt == system && r.messages == messages)
        #expect(r.temperature == 0.7 && r.jsonMode && r.maxTokens == 1024 && r.timeout == 30)
    }

    @Test(arguments: Language.allCases) func refineApply(lang: Language) throws {
        let f = try fixture()
        let r = Refine.applyRequest(text: f["text"] as! String, language: lang, instruction: f["instruction"] as! String, step: step)
        let (system, messages) = expected(f, "refineApply", lang.rawValue)
        #expect(r.systemPrompt == system && r.messages == messages)
        #expect(r.temperature == 0 && r.maxTokens == 4096 && r.timeout == 60)
    }

    @Test func englishTerms() throws {
        let f = try fixture()
        let r = EnglishTerms.request(text: f["text"] as! String, step: step)
        let (system, messages) = expected(f, "englishTerms")
        #expect(r.systemPrompt == system && r.messages == messages)
        #expect(r.temperature == 0 && r.jsonMode && r.maxTokens == 1024 && r.timeout == 30)
    }
}
