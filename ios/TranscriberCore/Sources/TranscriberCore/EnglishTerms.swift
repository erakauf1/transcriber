import Foundation

public struct EnglishTerm: Codable, Equatable, Sendable {
    public let he: String
    public let en: String
    public init(he: String, en: String) { self.he = he; self.en = en }
}

/// The model only proposes Hebrew→English pairs; code applies a pair only when the
/// replacement is Latin, so a Hebrew name can never become a different Hebrew name.
public enum EnglishTerms {
    public static let systemPrompt = [
        #"You read a Hebrew voice-note transcript. The speech-to-text step sometimes writes English words that the speaker said in English using Hebrew letters — job titles, tech and business terms, acronyms."#,
        #"Find those words and give their English spelling, judging from the context of the whole message."#,
        "",
        #"Include only terms an Israeli would naturally type in English in a work chat — e.g. VP, CTO, engineering, product, deploy, staging, sprint, backend, dashboard, follow-up."#,
        #"Do not include:"#,
        #"- Names of people, places, companies, or products — leave every name in Hebrew, even a foreign one"#,
        #"- Loanwords that are normally written in Hebrew letters (טלפון, מחשב, אינטרנט, מייל, אוטו)"#,
        #"- Ordinary Hebrew words, even if they could also be read as a transliteration"#,
        #"When unsure, leave the word out."#,
        "",
        #"Return a JSON object in this exact shape: {"terms": [{"he": "...", "en": "..."}]}"#,
        #"- "he" is the word or phrase exactly as it appears in the transcript, without attached Hebrew prefix letters (ב ל ה ו כ מ ש): for "לסטייג'ינג" give "סטייג'ינג""#,
        #"- A multi-word term goes in one entry: {"he": "ויפי סיילס", "en": "VP sales"}"#,
        #"- "en" is written only in Latin letters, lowercase except acronyms and proper capitalization (VP, CTO, QA, API)"#,
        #"- If there are none, return {"terms": []}"#,
    ].joined(separator: "\n")

    static let latinTerm = try! NSRegularExpression(pattern: #"^[A-Za-z0-9](?:[A-Za-z0-9 .&'/+-]*[A-Za-z0-9.+])?$"#)
    static let hebrewChar = try! NSRegularExpression(pattern: "[\(Hebrew.rangePattern)]")

    public static func request(text: String, step: StepConfig) -> ChatRequest {
        ChatRequest(provider: step.provider, model: step.model, apiKey: step.apiKey, systemPrompt: systemPrompt,
                    messages: [ChatMessage(role: "user", content: text)],
                    temperature: 0, maxTokens: 1024, jsonMode: true, timeout: 30)
    }

    /// Anthropic has no JSON mode, so tolerate a fenced or prefaced reply.
    public static func parse(_ content: String) throws -> [EnglishTerm] {
        guard let start = content.firstIndex(of: "{"), let end = content.lastIndex(of: "}"), start < end else {
            throw ServiceError("Could not parse terms")
        }
        struct Reply: Decodable { let terms: [EnglishTerm]? }
        return try JSONDecoder().decode(Reply.self, from: Data(content[start...end].utf8)).terms ?? []
    }

    public static func apply(_ text: String, terms: [EnglishTerm]) -> String {
        func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
            re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
        }
        let valid = terms
            .map { EnglishTerm(he: $0.he.trimmingCharacters(in: .whitespaces), en: $0.en.trimmingCharacters(in: .whitespaces)) }
            .filter { matches(hebrewChar, $0.he) && matches(latinTerm, $0.en) }
            .sorted { $0.he.count > $1.he.count }

        var out = text
        for term in valid {
            let pattern = "(^|[^\(Hebrew.rangePattern)])([\(Hebrew.prefixes)]{0,2})"
                + NSRegularExpression.escapedPattern(for: term.he)
                + "(?![\(Hebrew.rangePattern)])"
            guard let re = try? NSRegularExpression(pattern: pattern) else { continue }
            out = re.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out),
                                              withTemplate: "$1$2" + NSRegularExpression.escapedTemplate(for: term.en))
        }
        return out
    }

    public static func restore(text: String, language: Language, step: StepConfig, client: LLMClient,
                               onUsage: UsageHandler? = nil) async -> String {
        guard language == .he, !step.apiKey.isEmpty else { return text }
        do {
            let content = try await client.send(request(text: text, step: step), onUsage: onUsage)
            return apply(text, terms: try parse(content))
        } catch {
            return text
        }
    }
}
