import SwiftData
import SwiftUI

struct HistoryView: View {
    @Environment(HistoryStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Note.createdAt, order: .reverse) private var notes: [Note]

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
            .navigationTitle("History")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Text("History is encrypted and stays on this iPhone. It is not backed up — use Export to keep a copy.")
                    .font(.caption2).foregroundStyle(.secondary).padding()
            }
        }
    }
}

private struct NoteRow: View {
    let note: DecryptedNote
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(note.readable ? note.bestText : "Can't be read").lineLimit(2)
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
