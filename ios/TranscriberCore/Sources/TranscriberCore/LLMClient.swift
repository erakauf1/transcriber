import Foundation

public struct ChatMessage: Codable, Equatable, Sendable {
    public var role: String
    public var content: String
    public init(role: String, content: String) { self.role = role; self.content = content }
}

public struct ChatRequest: Sendable {
    public var provider: Provider
    public var model: String
    public var apiKey: String
    public var systemPrompt: String
    public var messages: [ChatMessage]
    public var temperature: Double?
    public var maxTokens: Int
    public var jsonMode: Bool
    public var timeout: TimeInterval

    public init(provider: Provider, model: String, apiKey: String, systemPrompt: String, messages: [ChatMessage],
                temperature: Double? = nil, maxTokens: Int, jsonMode: Bool = false, timeout: TimeInterval = 60) {
        self.provider = provider; self.model = model; self.apiKey = apiKey; self.systemPrompt = systemPrompt
        self.messages = messages; self.temperature = temperature; self.maxTokens = maxTokens
        self.jsonMode = jsonMode; self.timeout = timeout
    }
}

public struct Usage: Equatable, Sendable {
    public let provider: Provider
    public let model: String
    public let inputTokens: Int
    public let outputTokens: Int
    public let costUsd: Double?
}

public typealias UsageHandler = @Sendable (Usage) -> Void

public struct LLMClient: Sendable {
    static let anthropicURL = URL(string: "https://api.anthropic.com/v1/messages")!
    static let openAIURL = URL(string: "https://api.openai.com/v1/chat/completions")!
    static let openRouterURL = URL(string: "https://openrouter.ai/api/v1/chat/completions")!

    let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func send(_ r: ChatRequest, onUsage: UsageHandler? = nil) async throws -> String {
        r.provider == .anthropic ? try await anthropic(r, onUsage) : try await openAICompatible(r, onUsage)
    }

    // Newer Claude models reject `thinking: disabled` with a 400, so each gets the closest
    // low-thinking setting it accepts, plus output headroom when it always thinks.
    static func anthropicThinkingParams(model: String, maxTokens: Int) -> [String: Any] {
        if model == "claude-sonnet-5-5" { return ["thinking": ["type": "between_tools"], "max_tokens": maxTokens] }
        if model == "claude-opus-5-5" || model.hasPrefix("claude-fable-") {
            return ["output_config": ["effort": "low"], "max_tokens": max(maxTokens, 16000)]
        }
        return ["thinking": ["type": "disabled"], "max_tokens": maxTokens]
    }

    private func anthropic(_ r: ChatRequest, _ onUsage: UsageHandler?) async throws -> String {
        var body: [String: Any] = [
            "model": r.model,
            "system": r.systemPrompt,
            "messages": r.messages.map { ["role": $0.role, "content": $0.content] },
        ]
        body.merge(Self.anthropicThinkingParams(model: r.model, maxTokens: r.maxTokens)) { _, new in new }
        let data = try await post(Self.anthropicURL, body: body, timeout: r.timeout, headers: [
            "x-api-key": r.apiKey,
            "anthropic-version": "2023-06-01",
        ])
        let usage = data["usage"] as? [String: Any]
        report(onUsage, r, input: usage?["input_tokens"] as? Int, output: usage?["output_tokens"] as? Int, reported: nil)
        if data["stop_reason"] as? String == "refusal" {
            throw ServiceError("The model declined this request — try again or pick another model")
        }
        let blocks = data["content"] as? [[String: Any]] ?? []
        let text = (blocks.first { $0["type"] as? String == "text" }?["text"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ServiceError("Empty response") }
        return text
    }

    private func openAICompatible(_ r: ChatRequest, _ onUsage: UsageHandler?) async throws -> String {
        var headers = ["Authorization": "Bearer \(r.apiKey)"]
        if r.provider == .openrouter {
            headers["HTTP-Referer"] = "https://the-transcriber.netlify.app"
            headers["X-Title"] = "Voice Note Transcriber"
        }
        var body: [String: Any] = [
            "model": r.model,
            "messages": [["role": "system", "content": r.systemPrompt]] + r.messages.map { ["role": $0.role, "content": $0.content] },
        ]
        if let t = r.temperature { body["temperature"] = t }
        if r.jsonMode { body["response_format"] = ["type": "json_object"] }
        let url = r.provider == .openrouter ? Self.openRouterURL : Self.openAIURL
        let data = try await post(url, body: body, timeout: r.timeout, headers: headers)
        let usage = data["usage"] as? [String: Any]
        report(onUsage, r, input: usage?["prompt_tokens"] as? Int, output: usage?["completion_tokens"] as? Int,
               reported: usage?["cost"] as? Double)
        let choices = data["choices"] as? [[String: Any]]
        let message = choices?.first?["message"] as? [String: Any]
        let text = (message?["content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ServiceError("Empty response") }
        return text
    }

    private func report(_ onUsage: UsageHandler?, _ r: ChatRequest, input: Int?, output: Int?, reported: Double?) {
        guard let onUsage else { return }
        let i = input ?? 0, o = output ?? 0
        onUsage(Usage(provider: r.provider, model: r.model, inputTokens: i, outputTokens: o,
                      costUsd: Pricing.estimateCost(model: r.model, inputTokens: i, outputTokens: o, reportedCost: reported)))
    }

    private func post(_ url: URL, body: [String: Any], timeout: TimeInterval, headers: [String: String]) async throws -> [String: Any] {
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await session.data(for: req) }
        catch { throw ServiceError("Network error: \(error.localizedDescription)") }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (200..<300).contains(status) else {
            if let detail = (json?["error"] as? [String: Any])?["message"] as? String {
                throw ServiceError("Request failed: \(detail)")
            }
            throw ServiceError("Request failed (HTTP \(status))")
        }
        return json ?? [:]
    }
}
