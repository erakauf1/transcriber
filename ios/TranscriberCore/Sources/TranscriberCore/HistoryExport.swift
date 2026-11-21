import Foundation

public struct ExportEntry: Encodable, Sendable {
    public let date: Date
    public let text: String
    public let cleaned: String?
    public let language: Language?
    public let provider: Provider?
    public let model: String?

    public init(date: Date, text: String, cleaned: String?, language: Language?, provider: Provider?, model: String?) {
        self.date = date; self.text = text; self.cleaned = cleaned
        self.language = language; self.provider = provider; self.model = model
    }

    enum CodingKeys: String, CodingKey { case name, text, cleaned, language, date, provider, model }

    // Explicit so `cleaned` is written as null rather than omitted.
    public func encode(to encoder: Encoder) throws {
        // ISO8601FormatStyle is Sendable; a static DateFormatter fails Swift 6 strict concurrency.
        let iso = date.formatted(.iso8601)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(String(iso.dropLast()).replacingOccurrences(of: ":", with: "-"), forKey: .name)
        try c.encode(text, forKey: .text)
        try c.encode(cleaned, forKey: .cleaned)
        try c.encode(language, forKey: .language)
        try c.encode(iso, forKey: .date)
        try c.encode(provider, forKey: .provider)
        try c.encode(model, forKey: .model)
    }
}

public enum HistoryExport {
    public static func encode(_ entries: [ExportEntry]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        return try encoder.encode(entries.sorted { $0.date < $1.date })
    }
}
