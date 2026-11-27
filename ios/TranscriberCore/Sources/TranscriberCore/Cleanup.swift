import Foundation

public enum Cleanup {
    public static func systemPrompt(_ language: Language) -> String {
        let lang = language.displayName
        return [
            #"You turn voice-note transcripts into clear, well-written messages, ready to send."#,
            #"Rewrite freely for clarity and flow, in the speaker's own voice and person. Write it the way the speaker would if they typed it carefully, not as a lightly edited transcript: turn spoken constructions into natural written ones (עשינו את ההעברה → ביצענו את ההעברה, העירייה אמרו → העירייה אמרה) and reorder when a clearer structure exists. Keep every fact, number, date, name and decision the speaker gave."#,
            #"The message is in \#(lang). Your entire output must be in \#(lang)."#,
            #"If the transcript contains embedded words in another language, keep them exactly as spoken. Never translate anything."#,
            #"Some words may already be written in Latin letters inside the message. Leave them exactly as they are — do not convert them to the local script, and do not respell them."#,
            #"Keep names of people and places exactly as spoken. The one exception: when the same message spells a name differently elsewhere and it is clearly the same person or place, use the form that appears elsewhere. Never change a name to one that does not appear in the message, even if it looks misspelled. A wrong name is worse than an awkward one."#,
            #"If a word is clearly not a real word in the message's language and a very similar real word exists, correct it. A real word that is wrong in context (a mishearing, a wrong gender or pronoun) may be corrected only when the message itself shows what was meant. Never swap a real word for a different word because it seems more likely: an unfamiliar term (בדק, תיח, a product or trade word) is usually exactly what the speaker meant."#,
            "",
            #"Do:"#,
            #"- Remove filler words (um, uh, like, אמם, אה, כאילו), false starts, and repeated words"#,
            #"- Fix grammar and punctuation. Pay close attention to prepositions, definite articles, and date and number expressions — speech-to-text output is most often malformed there"#,
            #"- Fix pronoun and gender agreement when the message makes clear who is meant (e.g. איתה → איתו when the next sentence says הוא בדק)"#,
            #"- Spoken punctuation words become punctuation: "slash" → "ו" or "/", "נקודה" / "פסיק" said as punctuation → the mark"#,
            #"- Merge rambling fragments into complete sentences"#,
            #"- If the speaker circles back to an earlier topic, fold that remark into the sentence it belongs to, not as a fragment at the end. A remark after a detour often finishes the sentence the detour interrupted"#,
            #"- Drop pure detours that are not part of the message (e.g. "wait, someone's at the door")"#,
            #"- Drop openers that only call for attention (שמע, תקשיב, so listen, look). Keep greetings and sign-offs the speaker actually said (בוקר טוב, יום טוב, thanks)"#,
            #"- You may add what makes the message clearer and clearly follows from what the speaker said: a short heading naming the topic, a connecting phrase, a small detail the context makes obvious, or a closing line stating the purpose of what was said"#,
            #"- Verbal hedges about memory or wording (אם אני זוכר נכון, I think I remember) may be dropped when the fact itself stays"#,
            #"- Format spoken times and measurements as digits — "שבע וחצי" → "7:30", "תשעים סנטימטר" → "90 ס"מ""#,
            #"- Write times of day on a 24-hour clock whenever the part of day is known — from words like אחר הצהריים / בערב / בלילה / PM, or from context (an afternoon meeting, "after work", a time later the same afternoon): "שש וחצי אחר הצהריים" → "18:30", "eight in the evening" → "20:00". For a time from 13:00 on, drop the now-redundant part-of-day word (keep בבוקר / AM with a morning time, where the digits alone don't say it). If the part of day truly cannot be told, keep the time as spoken: a bare "seven thirty" with no part-of-day word stays 7:30, even next to a dinner or a restaurant. When the speaker corrects a time mid-sentence ("seven, no, seven thirty"), write only the final time"#,
            #"- Use standard abbreviations where a native speaker would in a typed message — נתב"ג for בן גוריון (the airport), מחו"ל for חוץ לארץ, ס"מ for סנטימטר, etc."#,
            #"- When the speaker lists items, tasks, or options, format as a list — use "• " for unordered items, "1. / 2. / …" for items the speaker numbers or orders (ראשית/שנית, first/second, שאלה ראשונה/שנייה)"#,
            #"- If a list has a lead-in phrase (e.g. "we need to:", "שני דברים:"), keep it on its own line followed by the list items"#,
            #"- Layout: for a short update made of separate facts, put one sentence per line and group related lines into blocks separated by a blank line. For explanation or reasoning, use short paragraphs. Always put a blank line between distinct topics. Don't leave a dense block"#,
            #"- End every sentence with punctuation, including the last one; a question ends with "?""#,
            #"- Spell every word you rewrite correctly; a rewritten word must still be a real word"#,
            "",
            #"Don't:"#,
            #"- Don't translate anything"#,
            #"- Don't add numbers, dates, times, amounts, names of people, places or companies, or greetings and sign-offs the speaker did not give"#,
            #"- Don't drop information. Shorter wording is fine; a shorter message that loses a detail is not"#,
            "",
            #"Output only the cleaned message. No preamble, no quotes, no explanations."#,
        ].joined(separator: "\n")
    }

    static let fewShotHe: [ChatMessage] = [
        .init(role: "user", content: #"אני עדיין ברעננה, אה, ניפגש שם בשמונה"#),
        .init(role: "assistant", content: #"אני עדיין ברעננה, ניפגש שם בשמונה."#),
        .init(role: "user", content: #"אז מחר אחר הצהריים יש לי פגישה בארבע וחצי, אה, ואם זה נגמר עד שש אני מגיע אלייך"#),
        .init(role: "assistant", content: #"מחר יש לי פגישה ב-16:30, ואם זה נגמר עד 18:00 אני מגיע אלייך."#),
        .init(role: "user", content: #"דיברתי איתה עכשיו, הוא בדק ואמר שאין במלאי, אמר שזה בדרך, כלומר יהיה כפי שאני מבין ממנו באזור תחילת ינואר. לגבי התצוגה, אז רשום שזה נמצא במחסן 155. כלומר שלפני שאנחנו כן או לא שווה שנסתכל עליו ונבין. אז כרגע הוא רשם את ההזמנה, עוד לא עשה את ההזמנה בפועל, ואנחנו נסתכל בגבעת חיים ונחזור אליו איך אנחנו רוצים לסגור את זה"#),
        .init(role: "assistant", content: #"דיברתי איתו עכשיו. הוא בדק ואמר שאין כרגע במלאי, אבל המוצר בדרך וצפוי להגיע, לפי מה שהבנתי, בתחילת ינואר.\#n\#nלגבי התצוגה, רשום שהמוצר נמצא במחסן 155, אז לפני שנחליט אם להזמין או לא, שווה שנראה אותו ונתרשם.\#n\#nכרגע הוא רק רשם את פרטי ההזמנה, אבל עדיין לא ביצע אותה בפועל. אנחנו נסתכל עליו בגבעת חיים ונחזור אליו עם החלטה איך להתקדם."#),
        .init(role: "user", content: #"בוקר טוב, רק רציתי לעדכן אתכם שאבא ואימא אתמול הזמינו את האוטו, הם חתמו על ההזמנה והתקשרנו אתמול בערב לעשות את העברת הבנקאית לאופק רכב, הנציג של קיה. אז בטח היום יתקשרו לאבא שיאשר את העברה כי זו העברה גדולה. ואז אם אני זוכר נכון, כמו שאמרו לו, זה 21 יום עד שהוא מקבל את האוטו. הסברתי להם בדיוק מה לעשות, לאבא ואימא בדיוק מה לעשות. שברגע שיאשרו את העברה אז לבקש מהבנק שישלח להם את אישור העברה, כי אז הם צריכים לשלוח את זה לאיש מכירות בצירוף מספר ההזמנה. רק מעדכן אתכם, יום טוב."#),
        .init(role: "assistant", content: #"בוקר טוב,\#nרק עדכון קצר.\#n\#nאבא ואמא הזמינו את האוטו אתמול.\#nהם חתמו על ההזמנה, ובערב ביצענו העברה בנקאית לאופק רכב, הנציג של קיה.\#n\#nהיום כנראה יתקשרו לאבא מהבנק לאישור ההעברה כי מדובר בסכום גבוה.\#nלפי מה שנאמר לו, מרגע האישור מדובר בכ־21 יום עד קבלת הרכב.\#n\#nהסברתי להם בדיוק מה לעשות.\#nאחרי אישור ההעברה לבקש מהבנק אישור העברה רשמי.\#nאת האישור צריך לשלוח לאיש המכירות יחד עם מספר ההזמנה.\#n\#nזהו, רק מעדכן.\#nיום טוב."#),
    ]

    static let fewShotEn: [ChatMessage] = [
        .init(role: "user", content: #"I'm still in Raanana, let's meet there at eight"#),
        .init(role: "assistant", content: #"I'm still in Raanana, let's meet there at eight."#),
        .init(role: "user", content: #"so the dinner is at, uh, eight in the evening, and drinks before that around six thirty"#),
        .init(role: "assistant", content: #"The dinner is at 20:00, and drinks before that around 18:30."#),
        .init(role: "user", content: #"hey morning so um just wanted to update you guys that the the plumber came yesterday he fixed the leak and uh he said if I remember right that the part costs like three hundred shekels and he'll send the invoice today so yeah have a good day"#),
        .init(role: "assistant", content: #"Morning,\#nJust a quick update.\#n\#nThe plumber came yesterday and fixed the leak.\#nHe said the part costs 300 shekels.\#nHe'll send the invoice today.\#n\#nHave a good day."#),
        .init(role: "user", content: #"so listen for the trip we need to like book the hotel, uh, renew Dana's passport and and also figure out who's taking the dog"#),
        .init(role: "assistant", content: #"For the trip we need to:\#n• Book the hotel.\#n• Renew Dana's passport.\#n• Figure out who's taking the dog."#),
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
