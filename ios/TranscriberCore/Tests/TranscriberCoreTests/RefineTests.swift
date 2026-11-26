import Testing
@testable import TranscriberCore

struct RefineTests {
    @Test func parsesChipsObject() throws {
        let chips = try Refine.parseChips(#"{"chips":[{"label":" קצר ","instruction":" Make shorter "},{"label":"x"}]}"#)
        #expect(chips == [RefineChip(label: "קצר", instruction: "Make shorter")])
    }
    @Test func parsesBareArrayAndOptions() throws {
        #expect(try Refine.parseChips(#"[{"label":"a","instruction":"b"}]"#).count == 1)
        #expect(try Refine.parseChips(#"{"options":[{"label":"a","instruction":"b"}]}"#).count == 1)
    }
    @Test func toleratesFencedOrPrefacedReply() throws {
        let fenced = "```json\n{\"chips\":[{\"label\":\"a\",\"instruction\":\"b\"}]}\n```"
        #expect(try Refine.parseChips(fenced).count == 1)
        #expect(try Refine.parseChips("Here you go:\n[{\"label\":\"a\",\"instruction\":\"b\"}]").count == 1)
    }
    @Test func ignoresStrayBracketsAroundTheJSON() throws {
        let fenced = "4 options [JSON]:\n```json\n{\"chips\":[{\"label\":\"a\",\"instruction\":\"b\"}]}\n```\n(see [1])"
        #expect(try Refine.parseChips(fenced).count == 1)
        let bare = "4 options [JSON]: {\"chips\":[{\"label\":\"a\",\"instruction\":\"b\"}]} — enjoy"
        #expect(try Refine.parseChips(bare).count == 1)
    }
    @Test func capsAtFour() throws {
        let five = (1...5).map { #"{"label":"l\#($0)","instruction":"i"}"# }.joined(separator: ",")
        #expect(try Refine.parseChips("[\(five)]").count == 4)
    }
    @Test func errors() {
        #expect(throws: ServiceError("Could not parse suggestions")) { try Refine.parseChips("nope") }
        #expect(throws: ServiceError("No valid suggestions returned")) { try Refine.parseChips(#"{"chips":[]}"#) }
    }
}
