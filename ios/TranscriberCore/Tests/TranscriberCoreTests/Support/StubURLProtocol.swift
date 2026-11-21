import Foundation
import Synchronization

struct StubRequest: Sendable {
    let url: URL
    let headers: [String: String]
    let body: Data
    var json: [String: Any] { (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:] }
}

typealias StubHandler = @Sendable (StubRequest) -> (status: Int, body: Data)

/// Each session gets its own handler, keyed by a header, so parallel tests don't collide.
final class StubURLProtocol: URLProtocol {
    private static let handlers = Mutex<[String: StubHandler]>([:])
    private static let idHeader = "X-Stub-ID"

    static func session(_ handler: @escaping StubHandler) -> URLSession {
        let id = UUID().uuidString
        handlers.withLock { $0[id] = handler }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        config.httpAdditionalHeaders = [idHeader: id]
        return URLSession(configuration: config)
    }

    static func json(_ object: Any, status: Int = 200) -> (status: Int, body: Data) {
        (status, try! JSONSerialization.data(withJSONObject: object))
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let headers = request.allHTTPHeaderFields ?? [:]
        guard let id = headers[Self.idHeader], let handler = Self.handlers.withLock({ $0[id] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        let reply = handler(StubRequest(url: request.url!, headers: headers, body: Self.body(of: request)))
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func body(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}
