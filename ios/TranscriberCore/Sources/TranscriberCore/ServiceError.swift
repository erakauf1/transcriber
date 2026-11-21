import Foundation

public struct ServiceError: Error, Equatable, LocalizedError, Sendable {
    public let message: String

    public init(_ message: String) { self.message = message }

    public var errorDescription: String? { message }

    public func replacingPrefix(_ prefix: String, with replacement: String) -> ServiceError {
        message.hasPrefix(prefix) ? ServiceError(replacement + message.dropFirst(prefix.count)) : self
    }
}
