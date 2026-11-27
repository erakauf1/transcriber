import SwiftUI
import TranscriberCore

struct NoteDetailView: View {
    let note: DecryptedNote
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private var meta: String {
        var parts = [note.snapshot.createdAt.formatted(.dateTime.day().month().hour().minute())]
        if let seconds = note.snapshot.durationSeconds { parts.append(formatDuration(seconds)) }
        if let cost = note.snapshot.costUsd { parts.append(Pricing.format(cost)) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MetaRow(leading: Text(meta))
                if note.snapshot.status == .transcriptionFailed {
                    Text("This recording wasn't transcribed.")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .card()
                    Button("Retry transcription") {
                        model.retry(note.snapshot)
                        dismiss()
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    Text(note.bestText).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .environment(\.layoutDirection, note.snapshot.language == .he ? .rightToLeft : .leftToRight)
                        .card()
                    HStack(spacing: 10) {
                        ShareLink(item: note.bestText) { Label("Share", systemImage: "square.and.arrow.up") }
                            .buttonStyle(IconButtonStyle())
                        Button("Copy") { model.copy(note.bestText) }.buttonStyle(PrimaryButtonStyle())
                    }
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle("Note")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if note.readable, note.snapshot.status != .transcriptionFailed, !note.bestText.isEmpty { model.copy(note.bestText) }
        }
    }
}
