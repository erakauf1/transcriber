import SwiftData
import SwiftUI

struct HistoryView: View {
    @Environment(HistoryLock.self) private var lock
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if lock.isUnlocked {
                HistoryList()
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "lock.fill").font(.largeTitle)
                    Text("History is locked")
                    if let e = lock.error { Text(e).font(.footnote).foregroundStyle(.red) }
                    Button("Unlock") { Task { await lock.unlock() } }.buttonStyle(.borderedProminent)
                }
                .task { await lock.unlock() }
            }
        }
        // Covers the app-switcher snapshot, which is taken when the scene goes inactive.
        .overlay { if scenePhase != .active || lock.needsRelockCheck { Rectangle().fill(.regularMaterial).ignoresSafeArea() } }
        .onDisappear { lock.lock() }
    }
}

private struct HistoryList: View {
    @Environment(HistoryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Note.createdAt, order: .reverse) private var notes: [Note]
    @State private var exportURL: URL?
    @State private var exportError: String?

    private var notesFingerprint: [Int] {
        notes.map {
            var hasher = Hasher()
            hasher.combine($0.id); hasher.combine($0.status)
            hasher.combine($0.rawCipher); hasher.combine($0.cleanedCipher)
            return hasher.finalize()
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if store.hasUnreadable {
                    Section {
                        Text("History from a previous device can't be read.")
                        Button("Clear history", role: .destructive) { store.deleteAll() }
                    }
                }
                ForEach(notes) { note in
                    let d = store.text(of: note)
                    NavigationLink { NoteDetailView(note: d) } label: { NoteRow(note: d) }
                }
                .onDelete { $0.map { notes[$0] }.forEach(store.delete) }
            }
            .overlay { if notes.isEmpty { ContentUnavailableView("No notes yet", systemImage: "waveform") } }
            .task { store.refreshReadability() }
            .onChange(of: notesFingerprint) { exportURL = nil; store.removeExports() }
            .onDisappear { store.removeExports() }
            .navigationTitle("History")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) {
                    if let exportURL {
                        ShareLink(item: exportURL) { Label("Share export", systemImage: "square.and.arrow.up") }
                    } else {
                        Button("Export") {
                            do { exportURL = try store.exportFile() } catch { exportError = error.localizedDescription }
                        }
                        .disabled(!notes.contains { store.text(of: $0).readable })
                    }
                }
            }
            .alert("Export failed", isPresented: .constant(exportError != nil)) { Button("OK") { exportError = nil } } message: { Text(exportError ?? "") }
            .safeAreaInset(edge: .bottom) {
                VStack {
                    Text("History is encrypted and stays on this iPhone. It is not backed up — use Export to keep a copy.")
                        .font(.caption2).foregroundStyle(.secondary)
                    if exportURL != nil { Text("The export is plain text once it leaves the app.").font(.caption2).foregroundStyle(.orange) }
                }
                .padding()
            }
        }
    }
}

private struct NoteRow: View {
    let note: DecryptedNote
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(note.readable ? note.bestText : (note.locked ? "Locked" : "Can't be read")).lineLimit(2)
                .environment(\.layoutDirection, note.snapshot.language == .he ? .rightToLeft : .leftToRight)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack {
                Text(note.snapshot.createdAt, format: .dateTime.day().month().hour().minute())
                if note.snapshot.status == .transcriptionFailed { Text("· Not transcribed").foregroundStyle(.orange) }
                if note.snapshot.status == .cleanupFailed { Text("· Raw only").foregroundStyle(.orange) }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }
}
