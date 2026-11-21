import CryptoKit
import Foundation
import Observation
import SwiftData
import TranscriberCore
import UIKit

struct DecryptedNote {
    let raw: String?
    let cleaned: String?
    let readable: Bool
    let snapshot: NoteSnapshot
    var bestText: String { cleaned ?? raw ?? "" }
}

@MainActor @Observable
final class HistoryStore {
    let container: ModelContainer
    private(set) var hasUnreadable = false
    @ObservationIgnored private var queued: [NoteSnapshot] = []
    @ObservationIgnored private var cachedCipher: NoteCipher?
    private static let keyAccount = "history_key"

    init(container: ModelContainer) {
        self.container = container
        NotificationCenter.default.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.flushQueued() }
        }
    }

    static func makeContainer() -> ModelContainer {
        let dir = URL.applicationSupportDirectory.appending(path: "History", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete])
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            var mutableDir = dir
            try mutableDir.setResourceValues(values)
            let config = ModelConfiguration(url: dir.appending(path: "History.store"))
            return try ModelContainer(for: Note.self, configurations: config)
        } catch {
            return try! ModelContainer(for: Note.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        }
    }

    /// nil while the phone is locked (the key is WhenUnlockedThisDeviceOnly).
    private func cipher() -> NoteCipher? {
        if let cachedCipher { return cachedCipher }
        switch Keychain.read(Self.keyAccount) {
        case .found(let data):
            cachedCipher = NoteCipher(key: SymmetricKey(data: data))
        case .notFound:
            let key = SymmetricKey(size: .bits256)
            guard Keychain.set(key.withUnsafeBytes { Data($0) }, for: Self.keyAccount) else { return nil }
            cachedCipher = NoteCipher(key: key)
        case .unavailable:
            return nil
        }
        return cachedCipher
    }

    func upsert(_ s: NoteSnapshot) {
        // The store is .complete and the key is WhenUnlocked: while locked, hold the write in memory.
        guard UIApplication.shared.isProtectedDataAvailable, let cipher = cipher() else {
            queued.removeAll { $0.id == s.id }
            queued.append(s)
            return
        }
        let context = container.mainContext
        let id = s.id
        let existing = try? context.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.id == id })).first
        let note = existing ?? Note(id: s.id, createdAt: s.createdAt, status: s.status.rawValue)
        if existing == nil { context.insert(note) }
        note.status = s.status.rawValue
        note.language = s.language?.rawValue
        note.provider = s.provider?.rawValue
        note.model = s.model
        note.costUsd = s.costUsd
        note.pendingAudioFile = s.pendingAudioFile
        note.rawCipher = try? s.rawTranscript.map(cipher.seal)
        note.cleanedCipher = try? s.cleanedText.map(cipher.seal)
        try? context.save()
    }

    func flushQueued() {
        let pending = queued
        queued.removeAll()
        pending.forEach(upsert)
    }

    func text(of note: Note) -> DecryptedNote {
        let cipher = cipher()
        func open(_ data: Data?) -> (String?, Bool) {
            guard let data else { return (nil, true) }
            guard let cipher, let text = try? cipher.open(data) else { return (nil, false) }
            return (text, true)
        }
        let (raw, rawOK) = open(note.rawCipher)
        let (cleaned, cleanedOK) = open(note.cleanedCipher)
        let readable = rawOK && cleanedOK
        let snapshot = NoteSnapshot(id: note.id, createdAt: note.createdAt, rawTranscript: raw, cleanedText: cleaned,
                                    language: note.language.flatMap(Language.init(rawValue:)),
                                    provider: note.provider.flatMap(Provider.init(rawValue:)), model: note.model,
                                    costUsd: note.costUsd, status: NoteStatus(rawValue: note.status) ?? .done,
                                    pendingAudioFile: note.pendingAudioFile)
        return DecryptedNote(raw: raw, cleaned: cleaned, readable: readable, snapshot: snapshot)
    }

    // Kept out of text(of:): that runs inside view bodies, where mutating observed state loops.
    func refreshReadability() {
        let notes = (try? container.mainContext.fetch(FetchDescriptor<Note>())) ?? []
        hasUnreadable = notes.contains { !text(of: $0).readable }
    }

    func delete(_ note: Note) {
        if let file = note.pendingAudioFile { try? FileManager.default.removeItem(at: AudioFiles.url(named: file)) }
        container.mainContext.delete(note)
        try? container.mainContext.save()
    }

    func deleteAll() {
        let all = (try? container.mainContext.fetch(FetchDescriptor<Note>())) ?? []
        all.forEach(delete)
        hasUnreadable = false
    }

    func exportFile() throws -> URL {
        let notes = try container.mainContext.fetch(FetchDescriptor<Note>())
        let entries = notes.map(text(of:)).filter(\.readable).compactMap { d -> ExportEntry? in
            guard let raw = d.raw else { return nil }
            return ExportEntry(date: d.snapshot.createdAt, text: raw, cleaned: d.cleaned, language: d.snapshot.language,
                               provider: d.snapshot.provider, model: d.snapshot.model)
        }
        let stamp = Date.now.formatted(.iso8601.year().month().day())
        let url = FileManager.default.temporaryDirectory.appending(path: "transcriber-history-\(stamp).json")
        try HistoryExport.encode(entries).write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
}
