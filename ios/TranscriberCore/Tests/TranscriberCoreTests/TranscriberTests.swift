import Foundation
import Synchronization
import Testing
@testable import TranscriberCore

struct TranscriberTests {
    func audioFile() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID()).m4a")
        try Data("AUDIO".utf8).write(to: url)
        return url
    }

    @Test func uploadsMultipartWithScriptHint() async throws {
        let seen = Mutex<StubRequest?>(nil)
        let session = StubURLProtocol.session { req in
            seen.withLock { $0 = req }
            return StubURLProtocol.json(["text": "  שלום  "])
        }
        let text = try await Transcriber(session: session).transcribe(fileURL: try audioFile(), apiKey: "sk")
        #expect(text == "שלום")
        let req = try #require(seen.withLock { $0 })
        #expect(req.url.absoluteString == "https://api.openai.com/v1/audio/transcriptions")
        #expect(req.headers["Authorization"] == "Bearer sk")
        let body = String(decoding: req.body, as: UTF8.self)
        #expect(body.contains(#"filename="note.m4a""#))
        #expect(body.contains("gpt-4o-transcribe"))
        #expect(body.contains(Transcriber.scriptHint))
        #expect(body.contains("AUDIO"))
        #expect(!body.contains(#"name="language""#))
    }

    @Test func httpFailure() async throws {
        let session = StubURLProtocol.session { _ in (429, Data()) }
        await #expect(throws: ServiceError("Transcription failed (HTTP 429)")) {
            try await Transcriber(session: session).transcribe(fileURL: try audioFile(), apiKey: "sk")
        }
    }

    @Test func emptyText() async throws {
        let session = StubURLProtocol.session { _ in StubURLProtocol.json(["text": " "]) }
        await #expect(throws: ServiceError("Transcription returned empty text")) {
            try await Transcriber(session: session).transcribe(fileURL: try audioFile(), apiKey: "sk")
        }
    }
}
