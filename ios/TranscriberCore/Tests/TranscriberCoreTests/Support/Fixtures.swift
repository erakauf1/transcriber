import Foundation

enum Fixtures {
    // Tests/TranscriberCoreTests/Support/Fixtures.swift → repo root is six levels up.
    static let repoRoot: URL = {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url
    }()

    static func url(_ name: String) -> URL {
        repoRoot.appending(path: "fixtures").appending(path: name)
    }

    static func json(_ name: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(contentsOf: url(name)))
    }
}
