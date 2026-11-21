import Foundation
import Testing
@testable import TranscriberCore

struct EnglishTermsTests {
    @Test func replacesPhrases() {
        let out = EnglishTerms.apply("כי שני ויפי אינג'ינירינג עזבו, שניים או שלושה ויפי פרודקט עזבו",
            terms: [.init(he: "ויפי אינג'ינירינג", en: "VP engineering"), .init(he: "ויפי פרודקט", en: "VP product")])
        #expect(out == "כי שני VP engineering עזבו, שניים או שלושה VP product עזבו")
    }
    @Test func keepsPrefixes() {
        let out = EnglishTerms.apply("העלינו לסטייג'ינג מהבקנד",
            terms: [.init(he: "סטייג'ינג", en: "staging"), .init(he: "בקנד", en: "backend")])
        #expect(out == "העלינו לstaging מהbackend")
    }
    @Test func neverReplacesWithHebrew() {
        #expect(EnglishTerms.apply("אני עדיין ברעננה", terms: [.init(he: "רעננה", en: "הרצליה")]) == "אני עדיין ברעננה")
    }
    @Test func rejectsMixedScript() {
        #expect(EnglishTerms.apply("יש באג קטן", terms: [.init(he: "באג", en: "bugקטן")]) == "יש באג קטן")
    }
    @Test func ignoresMatchesInsideLongerWords() {
        #expect(EnglishTerms.apply("שמתי פרחים באגרטל", terms: [.init(he: "באג", en: "bug")]) == "שמתי פרחים באגרטל")
    }
    @Test func ignoresAbsentTerms() {
        #expect(EnglishTerms.apply("הכל בסדר", terms: [.init(he: "דיפלוי", en: "deploy")]) == "הכל בסדר")
    }
    @Test func ignoresEmptyEntries() {
        #expect(EnglishTerms.apply("יש באג", terms: [.init(he: "באג", en: ""), .init(he: "", en: "bug")]) == "יש באג")
    }
    @Test func acceptsPunctuation() {
        #expect(EnglishTerms.apply("ויפי אר אנד די", terms: [.init(he: "ויפי אר אנד די", en: "VP R&D")]) == "VP R&D")
        #expect(EnglishTerms.apply("נעשה פולו-אפ", terms: [.init(he: "פולו-אפ", en: "follow-up")]) == "נעשה follow-up")
    }
    @Test func missingTermsIsEmpty() throws {
        #expect(try EnglishTerms.parse("{}") == [])
    }
    @Test func longestPhraseWins() {
        let out = EnglishTerms.apply("ויפי סיילס וגם ויפי", terms: [.init(he: "ויפי", en: "VP"), .init(he: "ויפי סיילס", en: "VP sales")])
        #expect(out == "VP sales וגם VP")
    }
    @Test func parsesFencedReply() throws {
        #expect(try EnglishTerms.parse("Sure:\n```json\n{\"terms\":[{\"he\":\"דיפלוי\",\"en\":\"deploy\"}]}\n```") == [.init(he: "דיפלוי", en: "deploy")])
    }
    @Test func restoreSkipsEnglishAndNeverThrows() async {
        let step = StepConfig(provider: .openai, model: "m", apiKey: "k")
        let failing = LLMClient(session: StubURLProtocol.session { _ in (500, Data()) })
        #expect(await EnglishTerms.restore(text: "hello", language: .en, step: step, client: failing) == "hello")
        #expect(await EnglishTerms.restore(text: "שלום", language: .he, step: step, client: failing) == "שלום")
    }
}
