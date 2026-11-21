import Foundation
import Testing
@testable import TranscriberCore

struct HistoryExportTests {
    func entry(_ seconds: TimeInterval, cleaned: String?) -> ExportEntry {
        ExportEntry(date: Date(timeIntervalSince1970: seconds), text: "raw \(seconds)", cleaned: cleaned,
                    language: .he, provider: .anthropic, model: "claude-sonnet-5")
    }

    @Test func oldestFirstWithFixtureCompatibleKeys() throws {
        let data = try HistoryExport.encode([entry(200, cleaned: "c"), entry(100, cleaned: nil)])
        let arr = try #require(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        #expect(arr.count == 2)
        #expect(arr[0]["text"] as? String == "raw 100.0")
        #expect(arr[0]["cleaned"] is NSNull)
        #expect(arr[1]["cleaned"] as? String == "c")
        #expect(arr[0]["name"] as? String == "1970-01-01T00-01-40")
        #expect(arr[0]["date"] as? String == "1970-01-01T00:01:40Z")
        #expect(arr[0]["language"] as? String == "he")
        #expect(arr[0]["provider"] as? String == "anthropic")
        #expect(arr[0]["model"] as? String == "claude-sonnet-5")
    }

    @Test func hebrewIsNotEscaped() throws {
        let data = try HistoryExport.encode([ExportEntry(date: .now, text: "שלום", cleaned: nil, language: .he, provider: nil, model: nil)])
        #expect(String(decoding: data, as: UTF8.self).contains("שלום"))
    }
}
