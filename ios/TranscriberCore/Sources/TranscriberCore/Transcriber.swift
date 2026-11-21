import Foundation

public struct Transcriber: Sendable {
    public static let model = "gpt-4o-transcribe"
    public static let scriptHint =
        "This recording may mix languages. Write every word in its original script: " +
        "keep English words such as deploy, follow-up, meeting, standup, and sprint in Latin letters, " +
        "and keep Hebrew words in Hebrew letters. Do not transliterate between scripts."
    static let url = URL(string: "https://api.openai.com/v1/audio/transcriptions")!

    let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func transcribe(fileURL: URL, apiKey: String) async throws -> String {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"note.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".utf8))
        body.append(try Data(contentsOf: fileURL))
        body.append(Data("\r\n".utf8))
        field("model", Self.model)
        // No `language` field: auto-detect keeps code-switched words in their original script.
        field("prompt", Self.scriptHint)
        body.append(Data("--\(boundary)--\r\n".utf8))

        var req = URLRequest(url: Self.url, timeoutInterval: 120)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        let (data, response): (Data, URLResponse)
        do { (data, response) = try await session.data(for: req) }
        catch { throw ServiceError("Network error: \(error.localizedDescription)") }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw ServiceError("Transcription failed (HTTP \(status))") }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let text = (json?["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ServiceError("Transcription returned empty text") }
        return text
    }
}
