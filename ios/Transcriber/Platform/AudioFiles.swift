import Foundation

enum AudioFiles {
    // .completeUnlessOpen: a recording that is already open keeps writing after the phone locks.
    static let directory: URL = {
        var dir = URL.applicationSupportDirectory.appending(path: "PendingAudio", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUnlessOpen])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }()

    static func newURL() throws -> URL { directory.appending(path: "\(UUID().uuidString).m4a") }

    static func url(named name: String) -> URL { directory.appending(path: name) }
}
