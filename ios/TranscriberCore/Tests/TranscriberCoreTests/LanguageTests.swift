import Foundation
import Testing
@testable import TranscriberCore

struct LanguageTests {
    @Test func hebrew() { #expect(detectLanguage("שלום, מה קורה? רציתי להגיד לך משהו חשוב") == .he) }
    @Test func english() { #expect(detectLanguage("Hey, I wanted to tell you something important") == .en) }
    @Test func mixedHebrewMajority() { #expect(detectLanguage("אני צריך לעשות deploy למחר ואחרי זה לשלוח follow-up") == .he) }
    @Test func mixedEnglishMajority() { #expect(detectLanguage("I told Yossi שלום and then we discussed the whole deployment plan") == .en) }
    @Test func emptyIsEnglish() { #expect(detectLanguage("") == .en) }
    @Test func digitsAreEnglish() { #expect(detectLanguage("123 456!") == .en) }
    @Test func displayNames() { #expect(Language.he.displayName == "Hebrew"); #expect(Language.en.displayName == "English") }
    @Test func repoFixturesAreReachable() throws {
        #expect(FileManager.default.fileExists(atPath: Fixtures.url("transcripts.json").path))
    }
}
