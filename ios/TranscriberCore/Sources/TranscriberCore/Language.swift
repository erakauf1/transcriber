public enum Language: String, Codable, Sendable, CaseIterable {
    case he, en

    public var displayName: String { self == .he ? "Hebrew" : "English" }
}

public func detectLanguage(_ text: String) -> Language {
    var hebrew = 0, latin = 0
    for scalar in text.unicodeScalars {
        switch scalar.value {
        case 0x0590...0x05FF: hebrew += 1
        case 0x41...0x5A, 0x61...0x7A: latin += 1
        default: break
        }
    }
    return hebrew > latin ? .he : .en
}
