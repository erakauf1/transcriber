import Foundation
import SwiftData

@Model
final class Note {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    var language: String?
    var provider: String?
    var model: String?
    var costUsd: Double?
    var status: String
    var rawCipher: Data?
    var cleanedCipher: Data?
    var pendingAudioFile: String?

    init(id: UUID, createdAt: Date, status: String) {
        self.id = id; self.createdAt = createdAt; self.status = status
    }
}
