import Foundation
import Synchronization
import Testing
@testable import TranscriberCore

struct LLMClientTests {
    func request(_ provider: Provider, model: String = "m", jsonMode: Bool = false, temperature: Double? = nil) -> ChatRequest {
        ChatRequest(provider: provider, model: model, apiKey: "key", systemPrompt: "sys",
                    messages: [ChatMessage(role: "user", content: "hello")],
                    temperature: temperature, maxTokens: 4096, jsonMode: jsonMode, timeout: 30)
    }

    @Test func anthropicRequestShape() async throws {
        let seen = Mutex<StubRequest?>(nil)
        let session = StubURLProtocol.session { req in
            seen.withLock { $0 = req }
            return StubURLProtocol.json(["content": [["type": "text", "text": "  hi  "]], "usage": ["input_tokens": 1000000, "output_tokens": 0]])
        }
        let usage = Mutex<Usage?>(nil)
        let out = try await LLMClient(session: session).send(request(.anthropic, model: "claude-sonnet-5")) { u in usage.withLock { $0 = u } }
        #expect(out == "hi")
        let req = try #require(seen.withLock { $0 })
        #expect(req.url.absoluteString == "https://api.anthropic.com/v1/messages")
        #expect(req.headers["x-api-key"] == "key")
        #expect(req.headers["anthropic-version"] == "2023-06-01")
        let body = req.json
        #expect(body["model"] as? String == "claude-sonnet-5")
        #expect(body["max_tokens"] as? Int == 4096)
        #expect(body["system"] as? String == "sys")
        #expect((body["thinking"] as? [String: String]) == ["type": "disabled"])
        #expect(body["temperature"] == nil)
        #expect(usage.withLock { $0 }?.costUsd == 2)
    }

    @Test(arguments: [
        ("claude-sonnet-5", "thinking", 4096),
        ("claude-sonnet-5-5", "thinking", 4096),
        ("claude-opus-5-5", "output_config", 16000),
        ("claude-fable-5-2", "output_config", 16000),
    ])
    func anthropicThinkingParams(model: String, key: String, maxTokens: Int) async throws {
        let seen = Mutex<[String: Any]>([:])
        let session = StubURLProtocol.session { req in
            seen.withLock { $0 = req.json }
            return StubURLProtocol.json(["content": [["type": "text", "text": "ok"]]])
        }
        _ = try await LLMClient(session: session).send(request(.anthropic, model: model))
        let body = seen.withLock { $0 }
        #expect(body[key] != nil)
        #expect(body["max_tokens"] as? Int == maxTokens)
        if model == "claude-sonnet-5-5" { #expect((body["thinking"] as? [String: String]) == ["type": "between_tools"]) }
        if key == "output_config" { #expect((body["output_config"] as? [String: String]) == ["effort": "low"]) }
    }

    @Test func anthropicRefusal() async {
        let session = StubURLProtocol.session { _ in StubURLProtocol.json(["stop_reason": "refusal", "content": []]) }
        await #expect(throws: ServiceError("The model declined this request — try again or pick another model")) {
            try await LLMClient(session: session).send(request(.anthropic))
        }
    }

    @Test func openRouterShapeAndReportedCost() async throws {
        let seen = Mutex<StubRequest?>(nil)
        let session = StubURLProtocol.session { req in
            seen.withLock { $0 = req }
            return StubURLProtocol.json(["choices": [["message": ["content": " out "]]], "usage": ["prompt_tokens": 1, "completion_tokens": 2, "cost": 0.25]])
        }
        let usage = Mutex<Usage?>(nil)
        let out = try await LLMClient(session: session).send(request(.openrouter, jsonMode: true, temperature: 0.7)) { u in usage.withLock { $0 = u } }
        #expect(out == "out")
        let req = try #require(seen.withLock { $0 })
        #expect(req.url.absoluteString == "https://openrouter.ai/api/v1/chat/completions")
        #expect(req.headers["Authorization"] == "Bearer key")
        #expect(req.headers["X-Title"] == "Voice Note Transcriber")
        #expect(req.headers["HTTP-Referer"] == "https://the-transcriber.netlify.app")
        let body = req.json
        #expect(body["temperature"] as? Double == 0.7)
        #expect((body["response_format"] as? [String: String]) == ["type": "json_object"])
        let messages = body["messages"] as? [[String: String]]
        #expect(messages == [["role": "system", "content": "sys"], ["role": "user", "content": "hello"]])
        #expect(usage.withLock { $0 }?.costUsd == 0.25)
    }

    @Test func openAIEndpointWithoutAttribution() async throws {
        let seen = Mutex<StubRequest?>(nil)
        let session = StubURLProtocol.session { req in
            seen.withLock { $0 = req }
            return StubURLProtocol.json(["choices": [["message": ["content": "x"]]]])
        }
        _ = try await LLMClient(session: session).send(request(.openai))
        let req = try #require(seen.withLock { $0 })
        #expect(req.url.absoluteString == "https://api.openai.com/v1/chat/completions")
        #expect(req.headers["X-Title"] == nil)
        #expect(req.json["response_format"] == nil)
    }

    @Test func httpErrorUsesProviderMessage() async {
        let session = StubURLProtocol.session { _ in StubURLProtocol.json(["error": ["message": "bad key"]], status: 401) }
        await #expect(throws: ServiceError("Request failed: bad key")) { try await LLMClient(session: session).send(request(.openai)) }
    }

    @Test func httpErrorWithoutBody() async {
        let session = StubURLProtocol.session { _ in (500, Data()) }
        await #expect(throws: ServiceError("Request failed (HTTP 500)")) { try await LLMClient(session: session).send(request(.anthropic)) }
    }

    @Test func emptyResponse() async {
        let session = StubURLProtocol.session { _ in StubURLProtocol.json(["choices": [["message": ["content": "  "]]]]) }
        await #expect(throws: ServiceError("Empty response")) { try await LLMClient(session: session).send(request(.openai)) }
    }
}
