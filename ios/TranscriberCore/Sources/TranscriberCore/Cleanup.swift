import Foundation

public enum Cleanup {
    public static func systemPrompt(_ language: Language) -> String {
        let lang = language.displayName
        return [
            #"You clean up voice-note transcripts so they can be sent as chat messages."#,
            #"The message is in \#(lang). Your entire output must be in \#(lang)."#,
            #"If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything."#,
            #"Some words may already be written in Latin letters inside the message. Leave them exactly as they are — do not convert them to the local script, and do not respell them."#,
            #"Never change a name of a person or place — not its script, not its spelling, and never to a different name, even if it looks misspelled or reads awkwardly in context. A wrong name is worse than an awkward one."#,
            #"If a word is clearly not a real word in the message's language and a very similar real word exists, correct it — but never change one valid word to another."#,
            "",
            #"Do:"#,
            #"- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words"#,
            #"- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions — speech-to-text output is most often malformed there"#,
            #"- Merge rambling fragments into complete sentences"#,
            #"- If the speaker circles back to an earlier topic, fold that remark into where it belongs"#,
            #"- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")"#,
            #"- Add paragraph breaks (blank lines) between distinct topics or thoughts"#,
            #"- Format spoken times and measurements as digits — "שבע וחצי" → "7:30", "תשעים סנטימטר" → "90 ס"מ""#,
            #"- Write times of day on a 24-hour clock whenever the part of day is known — from words like אחר הצהריים / בערב / בלילה / PM, or from context (an afternoon meeting, "after work", a time later the same afternoon): "שש וחצי אחר הצהריים" → "18:30", "eight in the evening" → "20:00". For a time from 13:00 on, drop the now-redundant part-of-day word (keep בבוקר / AM with a morning time, where the digits alone don't say it). If the part of day truly cannot be told, keep the time as spoken"#,
            #"- Use standard abbreviations where a native speaker would in a typed message — נתב"ג for בן גוריון (the airport), מחו"ל for חוץ לארץ, ס"מ for סנטימטר, etc."#,
            #"- When the speaker lists items, tasks, or options, format as a list — use "• " for unordered items, "1. / 2. / …" for items the speaker numbers or orders (ראשית/שנית, first/second, שאלה ראשונה/שנייה)"#,
            #"- If a list has a lead-in phrase (e.g. "we need to:", "שני דברים:"), keep it on its own line followed by the list items"#,
            #"- Use a single line break (not a blank line) to separate closely related but distinct statements within the same topic — e.g. a decision and its reason, a question and its context"#,
            #"- Don’t cram everything into one dense block — when in doubt, break into shorter lines rather than long paragraphs"#,
            "",
            #"Don't:"#,
            #"- Don't translate anything"#,
            #"- Don't change slang or personal tone into formal writing"#,
            #"- Don't add content, greetings, or sign-offs that were not spoken"#,
            #"- Don't add a period at the end of the message — this is a chat message, not a formal document"#,
            #"- Don't summarize — keep the same message, just tighter"#,
            "",
            #"Output only the cleaned message. No preamble, no quotes, no explanations."#,
        ].joined(separator: "\n")
    }

    static let fewShotHe: [ChatMessage] = [
        .init(role: "user", content: #"אה אז אני חושב ש- שנצטרך לדחות את זה, את הפגישה, ליום שלישי כי, כי יש לי משהו"#),
        .init(role: "assistant", content: #"אני חושב שנצטרך לדחות את הפגישה ליום שלישי כי יש לי משהו."#),
        .init(role: "user", content: #"אני עדיין ברעננה, אה, ניפגש שם בשמונה"#),
        .init(role: "assistant", content: #"אני עדיין ברעננה, ניפגש שם בשמונה."#),
        .init(role: "user", content: #"אממ אני צריך מונית לבן גוריון ביום שישי, הטיסה שלנו ממריאה בשבע וחצי בבוקר, אנחנו חמישה אנשים"#),
        .init(role: "assistant", content: #"אני צריך מונית לנתב"ג ביום שישי. הטיסה שלנו ממריאה ב-7:30 בבוקר, אנחנו חמישה אנשים"#),
        .init(role: "user", content: #"אז מחר אחר הצהריים יש לי פגישה בארבע וחצי, אה, ואם זה נגמר עד שש אני מגיע אלייך"#),
        .init(role: "assistant", content: #"מחר יש לי פגישה ב-16:30, ואם זה נגמר עד 18:00 אני מגיע אלייך"#),
    ]

    static let fewShotEn: [ChatMessage] = [
        .init(role: "user", content: #"so um I think we should, we should probably push the meeting to, to Tuesday because I have this thing"#),
        .init(role: "assistant", content: #"I think we should push the meeting to Tuesday because I have this thing."#),
        .init(role: "user", content: #"I'm still in Raanana, let's meet there at eight"#),
        .init(role: "assistant", content: #"I'm still in Raanana, let's meet there at eight."#),
        .init(role: "user", content: #"the flight's at seven thirty AM from JFK, um, five of us with three big bags"#),
        .init(role: "assistant", content: #"The flight's at 7:30 AM from JFK, five of us with three big bags"#),
        .init(role: "user", content: #"so the dinner is at, uh, eight in the evening, and drinks before that around six thirty"#),
        .init(role: "assistant", content: #"The dinner is at 20:00, and drinks before that around 18:30"#),
    ]

    public static func fewShot(_ language: Language) -> [ChatMessage] { language == .he ? fewShotHe : fewShotEn }

    public static func request(text: String, language: Language, step: StepConfig) -> ChatRequest {
        ChatRequest(provider: step.provider, model: step.model, apiKey: step.apiKey,
                    systemPrompt: systemPrompt(language),
                    messages: fewShot(language) + [ChatMessage(role: "user", content: text)],
                    maxTokens: 4096, timeout: 120)
    }

    public static func run(text: String, language: Language, step: StepConfig, client: LLMClient,
                           onUsage: UsageHandler? = nil) async throws -> String {
        guard !step.apiKey.isEmpty else { throw ServiceError("No \(step.provider.rawValue) API key configured") }
        do {
            return try await client.send(request(text: text, language: language, step: step), onUsage: onUsage)
        } catch let e as ServiceError {
            throw e.replacingPrefix("Request failed", with: "Cleanup failed")
                .replacingPrefix("Empty response", with: "Cleanup returned empty output")
        }
    }
}
