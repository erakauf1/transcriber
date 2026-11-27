import SwiftData
import SwiftUI
import TranscriberCore

struct HistoryView: View {
    @Environment(HistoryLock.self) private var lock
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if lock.isUnlocked {
                HistoryList()
            } else {
                VStack(spacing: 16) {
                    VStack(spacing: 12) {
                        Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
                        Text("History is locked").font(.headline)
                        if let e = lock.error { Text(e).font(.footnote).foregroundStyle(.red) }
                    }
                    .frame(maxWidth: .infinity)
                    .card(padding: 24)
                    Button("Unlock") { Task { await lock.unlock() } }.buttonStyle(PrimaryButtonStyle())
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemGroupedBackground).ignoresSafeArea())
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
    @State private var confirmDelete = false

    private var notesFingerprint: [Int] {
        notes.map {
            var hasher = Hasher()
            hasher.combine($0.id); hasher.combine($0.status)
            hasher.combine($0.rawCipher); hasher.combine($0.cleanedCipher)
            return hasher.finalize()
        }
    }

    private func dayTitle(_ title: DayTitle) -> String {
        switch title {
        case .today: "Today"
        case .yesterday: "Yesterday"
        case .date(let day): day.formatted(.dateTime.weekday(.wide).day().month())
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if store.hasUnreadable {
                    Section {
                        Text("History from a previous device can't be read.")
                        Button("Delete unreadable notes", role: .destructive) { confirmDelete = true }
                    }
                }
                ForEach(groupByDay(notes, date: { $0.createdAt }, now: .now), id: \.start) { group in
                    Section(dayTitle(group.title)) {
                        ForEach(group.items) { note in
                            let d = store.text(of: note)
                            if d.readable {
                                NavigationLink { NoteDetailView(note: d) } label: { NoteRow(note: d) }
                            } else {
                                NoteRow(note: d)
                            }
                        }
                        .onDelete { $0.map { group.items[$0] }.forEach(store.delete) }
                    }
                }
                // A list footer scrolls with the notes; a bottom inset covered them at large Dynamic Type.
                if !notes.isEmpty {
                    Section {} footer: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("History is encrypted and stays on this iPhone. It is not backed up — use Export to keep a copy.")
                            if exportURL != nil { Text("The export is plain text once it leaves the app.").foregroundStyle(.orange) }
                        }
                        .font(.caption2)
                    }
                }
            }
            .listStyle(.insetGrouped)
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
            .confirmationDialog("Delete notes that can't be read?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete unreadable notes", role: .destructive) { store.deleteUnreadable() }
            } message: {
                Text("This can't be undone. Notes that can be read are kept.")
            }
            .alert("Export failed", isPresented: .constant(exportError != nil)) { Button("OK") { exportError = nil } } message: { Text(exportError ?? "") }
        }
    }
}

private struct NoteRow: View {
    let note: DecryptedNote
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(note.readable ? note.bestText : (note.locked ? "Locked" : "Can't be read")).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .environment(\.layoutDirection, note.snapshot.language == .he ? .rightToLeft : .leftToRight)
            // One Text, not an HStack, so it wraps instead of truncating at large Dynamic Type.
            Text("\(note.snapshot.createdAt, format: .dateTime.hour(.twoDigits(amPM: .abbreviated)).minute())\(durationSuffix)\(statusSuffix)")
                .font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
    }

    private var durationSuffix: String {
        note.snapshot.durationSeconds.map { "\u{00A0}· \(formatDuration($0))" } ?? ""
    }

    private var statusSuffix: Text {
        switch note.snapshot.status {
        case .transcriptionFailed: Text("\u{00A0}· Not transcribed").foregroundStyle(.orange)
        case .cleanupFailed: Text("\u{00A0}· Raw only").foregroundStyle(.orange)
        default: Text("")
        }
    }
}
