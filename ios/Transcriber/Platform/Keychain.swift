import Foundation
import Security

enum KeychainRead { case found(Data), notFound, unavailable }

enum Keychain {
    static let service = "transcriber"

    private static func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func read(_ account: String) -> KeychainRead {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        switch SecItemCopyMatching(query as CFDictionary, &out) {
        case errSecSuccess: return (out as? Data).map(KeychainRead.found) ?? .notFound
        case errSecItemNotFound: return .notFound
        default: return .unavailable  // e.g. errSecInteractionNotAllowed while the phone is locked
        }
    }

    @discardableResult
    static func set(_ data: Data?, for account: String) -> Bool {
        guard let data else {
            let status = SecItemDelete(base(account) as CFDictionary)
            return status == errSecSuccess || status == errSecItemNotFound
        }
        let update = SecItemUpdate(base(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update != errSecItemNotFound { return update == errSecSuccess }
        var add = base(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func string(for account: String) -> String? {
        if case .found(let d) = read(account) { return String(data: d, encoding: .utf8) }
        return nil
    }

    static func setString(_ value: String, for account: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        set(trimmed.isEmpty ? nil : Data(trimmed.utf8), for: account)
    }
}
