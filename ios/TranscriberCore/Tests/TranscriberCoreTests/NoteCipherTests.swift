import CryptoKit
import Foundation
import Testing
@testable import TranscriberCore

struct NoteCipherTests {
    @Test func roundTripsHebrew() throws {
        let c = NoteCipher(key: SymmetricKey(size: .bits256))
        let sealed = try c.seal("שלום deploy")
        #expect(!String(decoding: sealed, as: UTF8.self).contains("deploy"))
        #expect(try c.open(sealed) == "שלום deploy")
    }

    @Test func wrongKeyIsUnreadable() throws {
        let sealed = try NoteCipher(key: SymmetricKey(size: .bits256)).seal("secret")
        #expect(throws: NoteCipher.Unreadable.self) { try NoteCipher(key: SymmetricKey(size: .bits256)).open(sealed) }
        #expect(throws: NoteCipher.Unreadable.self) { try NoteCipher(key: SymmetricKey(size: .bits256)).open(Data([1, 2, 3])) }
    }
}
