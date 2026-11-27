import Foundation

public struct RefineChip: Identifiable, Equatable, Sendable {
    public var id: String { label + "\u{0}" + instruction }
    public let label: String
    public let instruction: String
    public init(label: String, instruction: String) { self.label = label; self.instruction = instruction }
}

public enum Refine {
    public static func chipsRequest(text: String, language: Language, step: StepConfig) -> ChatRequest {
        let lang = language.displayName
        let system = [
            #"You suggest specific, useful one-tap refinement actions for a cleaned-up voice note message."#,
            #"The message is in \#(lang). Suggest 3–4 short actions that would genuinely improve THIS specific message."#,
            #"Return a JSON object in this exact shape: {"chips": [{"label": "...", "instruction": "..."}, ...]}"#,
            #"Rules:"#,
            #"- "label" is 2–4 words max, written in \#(lang) (so the user sees it in their language)"#,
            #"- "instruction" is always in English — it is the prompt used to transform the message"#,
            #"- Options must be specific to this content, not generic filler"#,
            #"- Do not suggest formatting already present in the message (e.g. don't suggest bullet points if they're already there)"#,
            #"- Examples of good labels: "Make shorter", "More formal", "Add details", "Softer tone", "Clearer request""#,
        ].joined(separator: "\n")
        return ChatRequest(provider: step.provider, model: step.model, apiKey: step.apiKey, systemPrompt: system,
                           messages: [ChatMessage(role: "user", content: text)],
                           temperature: 0.7, maxTokens: 1024, jsonMode: true, timeout: 30)
    }

    public static func parseChips(_ content: String) throws -> [RefineChip] {
        guard let parsed = jsonCandidates(content).lazy
            .compactMap({ try? JSONSerialization.jsonObject(with: Data($0.utf8)) }).first else {
            throw ServiceError("Could not parse suggestions")
        }
        let dict = parsed as? [String: Any]
        let array = (parsed as? [Any]) ?? (dict?["chips"] as? [Any]) ?? (dict?["options"] as? [Any])
        guard let array, !array.isEmpty else { throw ServiceError("No valid suggestions returned") }
        return array.prefix(4).compactMap { item in
            guard let c = item as? [String: Any], let label = c["label"], let instruction = c["instruction"] else { return nil }
            let l = "\(label)".trimmingCharacters(in: .whitespacesAndNewlines)
            let i = "\(instruction)".trimmingCharacters(in: .whitespacesAndNewlines)
            return l.isEmpty || i.isEmpty ? nil : RefineChip(label: l, instruction: i)
        }
    }

    // Anthropic has no JSON mode, so Claude may fence the reply or wrap it in prose that has brackets of its own.
    static func jsonCandidates(_ content: String) -> [Substring] {
        var out: [Substring] = [Substring(content)]
        if let open = content.range(of: "```"), let close = content.range(of: "```", range: open.upperBound..<content.endIndex) {
            let inner = content[open.upperBound..<close.lowerBound]
            out.append(inner.drop { $0 != "\n" && $0 != "{" && $0 != "[" })
        }
        let pairs: [(Character, Character)] = [("{", "}"), ("[", "]")]
        let spans: [Substring] = pairs.compactMap { o, c in
            guard let s = content.firstIndex(of: o), let e = content.lastIndex(of: c), s < e else { return nil }
            return content[s...e]
        }
        // The bracket that opens first is the outer one, so a bare array isn't read as its first chip.
        return out + spans.sorted { $0.startIndex < $1.startIndex }
    }

    public static func chips(text: String, language: Language, step: StepConfig, client: LLMClient,
                             onUsage: UsageHandler? = nil) async throws -> [RefineChip] {
        let content: String
        do { content = try await client.send(chipsRequest(text: text, language: language, step: step), onUsage: onUsage) }
        catch let e as ServiceError {
            throw e.replacingPrefix("Request failed", with: "Could not generate suggestions")
                .replacingPrefix("Empty response", with: "No suggestions returned")
        }
        return try parseChips(content)
    }

    public static func applyRequest(text: String, language: Language, instruction: String, step: StepConfig) -> ChatRequest {
        let lang = language.displayName
        let system = [
            #"You refine voice-note messages by applying a specific transformation."#,
            #"The message is in \#(lang). Never translate anything — preserve the language throughout."#,
            #"Keep the personal tone and meaning unless the instruction explicitly asks to change it."#,
            #"Output only the refined message. No preamble, no quotes, no explanations."#,
        ].joined(separator: "\n")
        return ChatRequest(provider: step.provider, model: step.model, apiKey: step.apiKey, systemPrompt: system,
                           messages: [ChatMessage(role: "user", content: "\(instruction):\n\n\(text)")],
                           temperature: 0, maxTokens: 4096, timeout: 60)
    }

    public static func apply(text: String, language: Language, instruction: String, step: StepConfig,
                             client: LLMClient, onUsage: UsageHandler? = nil) async throws -> String {
        do {
            return try await client.send(applyRequest(text: text, language: language, instruction: instruction, step: step), onUsage: onUsage)
        } catch let e as ServiceError {
            throw e.replacingPrefix("Request failed", with: "Refinement failed")
                .replacingPrefix("Empty response", with: "Refinement returned empty output")
        }
    }
}
