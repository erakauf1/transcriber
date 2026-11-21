import CryptoKit
import Foundation

public struct NoteCipher: Sendable {
    public struct Unreadable: Error {}

    private let key: SymmetricKey

    public init(key: SymmetricKey) { self.key = key }

    public func seal(_ text: String) throws -> Data {
        try AES.GCM.seal(Data(text.utf8), using: key).combined!
    }

    public func open(_ data: Data) throws -> String {
        do {
            let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key)
            guard let text = String(data: plain, encoding: .utf8) else { throw Unreadable() }
            return text
        } catch {
            throw Unreadable()
        }
    }
}
