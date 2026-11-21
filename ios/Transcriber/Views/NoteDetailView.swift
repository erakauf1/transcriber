import SwiftUI

struct NoteDetailView: View {
    let note: DecryptedNote
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if note.snapshot.status == .transcriptionFailed {
                    Text("This recording wasn't transcribed.").foregroundStyle(.secondary)
                    Button("Retry transcription") {
                        model.retry(note.snapshot)
                        dismiss()
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Text(note.bestText).textSelection(.enabled)
                        .environment(\.layoutDirection, note.snapshot.language == .he ? .rightToLeft : .leftToRight)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    HStack {
                        Button("Copy", systemImage: "doc.on.doc") { model.copy(note.bestText) }.buttonStyle(.borderedProminent)
                        ShareLink(item: note.bestText).buttonStyle(.bordered)
                    }
                }
            }
            .padding()
        }
        .navigationTitle(Text(note.snapshot.createdAt, format: .dateTime.day().month().hour().minute()))
        .onAppear { if note.snapshot.status != .transcriptionFailed { model.copy(note.bestText) } }
    }
}
