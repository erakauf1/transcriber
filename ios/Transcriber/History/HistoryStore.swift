import CryptoKit
import Foundation
import Observation
import OSLog
import SwiftData
import TranscriberCore
import UIKit

struct DecryptedNote {
    let raw: String?
    let cleaned: String?
    let readable: Bool
    let snapshot: NoteSnapshot
    var locked = false
    var bestText: String { cleaned ?? raw ?? "" }
}

private let log = Logger(subsystem: "com.erankaufman.transcriber", category: "history")

@MainActor @Observable
final class HistoryStore {
    private(set) var container: ModelContainer
    private(set) var hasUnreadable = false
    @ObservationIgnored private var queued: [NoteSnapshot] = []
    @ObservationIgnored private var isFlushing = false
    @ObservationIgnored private var deletedIDs: Set<UUID> = []
    @ObservationIgnored private var cachedCipher: NoteCipher?
    @ObservationIgnored private var didSweep = false
    @ObservationIgnored var ownedAudioFile: () -> String? = { nil }
    private static let keyAccount = "history_key"

    init(container: ModelContainer) {
        self.container = container
        NotificationCenter.default.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.protectedDataBecameAvailable() }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.retryPending() }
        }
    }

    private var onFallback: Bool { container.configurations.contains { $0.isStoredInMemoryOnly } }

    private static let storeName = "History.store"

    private static func protectStoreFiles(in dir: URL) {
        for suffix in ["", "-wal", "-shm"] {
            let path = dir.appending(path: storeName + suffix).path(percentEncoded: false)
            guard FileManager.default.fileExists(atPath: path) else { continue }
            do { try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: path) }
            catch { log.error("Protecting \(storeName + suffix, privacy: .public) failed: \(error.localizedDescription, privacy: .public)") }
        }
    }

    static func openOnDisk() -> ModelContainer? {
        let dir = URL.applicationSupportDirectory.appending(path: "History", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete])
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            var mutableDir = dir
            try mutableDir.setResourceValues(values)
            let config = ModelConfiguration(url: dir.appending(path: storeName))
            let container = try ModelContainer(for: Note.self, configurations: config)
            protectStoreFiles(in: dir)
            return container
        } catch {
            log.error("Opening the history store failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    static func makeContainer() -> ModelContainer {
        if let disk = openOnDisk() { return disk }
        return try! ModelContainer(for: Note.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    // A launch while locked can't open the .complete store; once unlocked, swap the real one in and replay the queue.
    private func protectedDataBecameAvailable() {
        retryPending()
        refreshReadability()
    }

    func retryPending() {
        guard !isFlushing else { return }
        if onFallback, let real = Self.openOnDisk() { container = real }
        if !queued.isEmpty { flushQueued() }
        sweepOrphanedAudio()
    }

    private func sweepOrphanedAudio() {
        guard !didSweep, !onFallback, UIApplication.shared.isProtectedDataAvailable, case .ready = existingKey() else { return }
        guard let notes = try? container.mainContext.fetch(FetchDescriptor<Note>()) else { return }
        let urls = (try? FileManager.default.contentsOfDirectory(at: AudioFiles.directory, includingPropertiesForKeys: [.creationDateKey])) ?? []
        didSweep = true
        let referenced = Set(notes.compactMap(\.pendingAudioFile) + queued.compactMap(\.pendingAudioFile))
        let owned = ownedAudioFile()
        for url in urls where url.pathExtension == "m4a" {
            let name = url.lastPathComponent
            guard !referenced.contains(name), name != owned else { continue }
            let created = (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .now
            upsert(NoteSnapshot(id: UUID(), createdAt: created, status: .transcriptionFailed, pendingAudioFile: name))
        }
    }

    private enum KeyState { case ready(NoteCipher), missing, locked }

    /// Never creates a key: safe to call from view bodies.
    private func existingKey() -> KeyState {
        if let cachedCipher { return .ready(cachedCipher) }
        switch Keychain.read(Self.keyAccount) {
        case .found(let data):
            let cipher = NoteCipher(key: SymmetricKey(data: data))
            cachedCipher = cipher
            return .ready(cipher)
        case .notFound: return .missing
        case .unavailable: return .locked
        }
    }

    /// Only writes may create the key. nil while the phone is locked (the key is WhenUnlockedThisDeviceOnly).
    private func cipherForWrite() -> NoteCipher? {
        switch existingKey() {
        case .ready(let cipher): return cipher
        case .locked: return nil
        case .missing:
            let key = SymmetricKey(size: .bits256)
            guard Keychain.set(key.withUnsafeBytes { Data($0) }, for: Self.keyAccount) else { return nil }
            cachedCipher = NoteCipher(key: key)
            return cachedCipher
        }
    }

    private func enqueue(_ s: NoteSnapshot) {
        queued.removeAll { $0.id == s.id }
        queued.append(s)
    }

    func upsert(_ s: NoteSnapshot) {
        retryPending()
        guard !deletedIDs.contains(s.id) else { return }
        // The store is .complete and the key is WhenUnlocked: while locked, hold the write in memory.
        guard UIApplication.shared.isProtectedDataAvailable, !onFallback, let cipher = cipherForWrite() else {
            enqueue(s)
            return
        }
        let rawCipher: Data?, cleanedCipher: Data?
        do {
            rawCipher = try s.rawTranscript.map(cipher.seal)
            cleanedCipher = try s.cleanedText.map(cipher.seal)
        } catch {
            log.error("Sealing a note failed: \(error.localizedDescription, privacy: .public)")
            enqueue(s)
            return
        }
        let context = container.mainContext
        let id = s.id
        let existing: Note?
        do {
            existing = try context.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.id == id })).first
        } catch {
            log.error("Fetching a note failed: \(error.localizedDescription, privacy: .public)")
            enqueue(s)
            return
        }
        let note = existing ?? Note(id: s.id, createdAt: s.createdAt, status: s.status.rawValue)
        if existing == nil { context.insert(note) }
        note.status = s.status.rawValue
        note.language = s.language?.rawValue
        note.provider = s.provider?.rawValue
        note.model = s.model
        note.costUsd = s.costUsd
        note.pendingAudioFile = s.pendingAudioFile
        note.rawCipher = rawCipher
        note.cleanedCipher = cleanedCipher
        do {
            try context.save()
        } catch {
            log.error("Saving a note failed: \(error.localizedDescription, privacy: .public)")
            context.rollback()
            enqueue(s)
            return
        }
        Self.protectStoreFiles(in: URL.applicationSupportDirectory.appending(path: "History", directoryHint: .isDirectory))
        releaseAudio(of: note, snapshot: s, context: context)
    }

    // Only a transcript that is already on disk lets go of the recording.
    private func releaseAudio(of note: Note, snapshot s: NoteSnapshot, context: ModelContext) {
        guard s.rawTranscript != nil, let file = s.pendingAudioFile else { return }
        removeAudio([file])
        // Keep the reference if the delete failed, or the launch sweep would revive it as an untranscribed duplicate.
        guard !FileManager.default.fileExists(atPath: AudioFiles.url(named: file).path) else { return }
        note.pendingAudioFile = nil
        do { try context.save() } catch {
            log.error("Clearing the audio reference failed: \(error.localizedDescription, privacy: .public)")
            context.rollback()
        }
    }

    func flushQueued() {
        guard !isFlushing else { return }
        isFlushing = true
        defer { isFlushing = false }
        let pending = queued
        queued.removeAll()
        pending.forEach(upsert)
    }

    func text(of note: Note) -> DecryptedNote {
        var locked = false
        var cipher: NoteCipher?
        switch existingKey() {
        case .ready(let c): cipher = c
        case .locked: locked = true
        case .missing: break
        }
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
        return DecryptedNote(raw: raw, cleaned: cleaned, readable: readable, snapshot: snapshot, locked: locked && !readable)
    }

    // Kept out of text(of:): that runs inside view bodies, where mutating observed state loops.
    // A locked phone is not "unreadable": only a reachable key that fails to open (or is gone) counts.
    func refreshReadability() {
        let notes = (try? container.mainContext.fetch(FetchDescriptor<Note>())) ?? []
        hasUnreadable = notes.contains { let d = text(of: $0); return !d.readable && !d.locked }
    }

    private func removeAudio(_ files: [String]) {
        files.forEach { try? FileManager.default.removeItem(at: AudioFiles.url(named: $0)) }
    }

    func delete(_ note: Note) {
        let id = note.id
        let files = [note.pendingAudioFile].compactMap { $0 }
        let context = container.mainContext
        context.delete(note)
        do {
            try context.save()
        } catch {
            log.error("Deleting a note failed: \(error.localizedDescription, privacy: .public)")
            context.rollback()
            return
        }
        queued.removeAll { $0.id == id }
        deletedIDs.insert(id)
        removeAudio(files)
    }

    func discardUntranscribed(id: UUID) {
        queued.removeAll { $0.id == id }
        deletedIDs.insert(id)
        let context = container.mainContext
        guard let note = try? context.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.id == id })).first,
              note.rawCipher == nil else { return }
        let files = [note.pendingAudioFile].compactMap { $0 }
        context.delete(note)
        do { try context.save() } catch {
            log.error("Discarding a note failed: \(error.localizedDescription, privacy: .public)")
            context.rollback()
            return
        }
        removeAudio(files)
    }

    func deleteUnreadable() {
        let context = container.mainContext
        let all: [Note]
        do { all = try context.fetch(FetchDescriptor<Note>()) } catch {
            log.error("Fetching notes to delete failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        let doomed = all.filter { let d = text(of: $0); return !d.readable && !d.locked }
        let ids = doomed.map(\.id)
        let files = doomed.compactMap(\.pendingAudioFile)
        doomed.forEach(context.delete)
        do {
            try context.save()
        } catch {
            log.error("Deleting unreadable notes failed: \(error.localizedDescription, privacy: .public)")
            context.rollback()
            return
        }
        deletedIDs.formUnion(ids)
        removeAudio(files)
        hasUnreadable = false
    }

    func removeExports() {
        let tmp = FileManager.default.temporaryDirectory
        let old = (try? FileManager.default.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil)) ?? []
        for url in old where url.lastPathComponent.hasPrefix("transcriber-history-") && url.pathExtension == "json" {
            try? FileManager.default.removeItem(at: url)
        }
    }

    func exportFile() throws -> URL {
        let notes = try container.mainContext.fetch(FetchDescriptor<Note>())
        let entries = notes.map(text(of:)).filter(\.readable).compactMap { d -> ExportEntry? in
            guard let raw = d.raw else { return nil }
            return ExportEntry(date: d.snapshot.createdAt, text: raw, cleaned: d.cleaned, language: d.snapshot.language,
                               provider: d.snapshot.provider, model: d.snapshot.model)
        }
        removeExports()
        let tmp = FileManager.default.temporaryDirectory
        let stamp = Date.now.formatted(.iso8601.year().month().day())
        let url = tmp.appending(path: "transcriber-history-\(stamp).json")
        try HistoryExport.encode(entries).write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
}
