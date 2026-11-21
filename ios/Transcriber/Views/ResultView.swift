import SwiftUI
import TranscriberCore

struct ResultView: View {
    @Environment(AppModel.self) private var model
    @State private var draft = ""
    @FocusState private var editing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error = model.state.error {
                HStack {
                    Text("Cleanup failed — showing the raw transcript. \(error)").font(.footnote).foregroundStyle(.orange)
                    Button("Retry cleanup") { model.retryCleanup() }.font(.footnote)
                }
            }
            TextEditor(text: $draft)
                .focused($editing)
                .environment(\.layoutDirection, model.state.language == .he ? .rightToLeft : .leftToRight)
                .scrollContentBackground(.hidden)
                .padding(8).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            if let cost = model.costText { Text(cost).font(.caption).foregroundStyle(.secondary) }
            if model.isRefining { ProgressView("Refining…") }
            if let e = model.refineError ?? model.chipsError { Text(e).font(.footnote).foregroundStyle(.red) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(model.chips) { chip in
                        Button(chip.label) { Task { await model.applyChip(chip) } }
                            .buttonStyle(.bordered).disabled(model.isRefining)
                    }
                }
            }
            HStack {
                Button("Copy", systemImage: "doc.on.doc") { commitDraft(); model.copyCurrent() }
                    .buttonStyle(.borderedProminent)
                ShareLink(item: model.currentText).buttonStyle(.bordered)
                Spacer()
                Button("New note") { model.reset() }
            }
        }
        .onAppear { draft = model.currentText }
        .onChange(of: model.currentText) { _, text in if !editing { draft = text } }
        .onChange(of: editing) { _, isEditing in if !isEditing { commitDraft() } }
        .toolbar {
            if editing { ToolbarItem(placement: .keyboard) { Button("Done") { editing = false } } }
        }
    }

    private func commitDraft() {
        if draft != model.currentText { model.commitEdit(draft) }
    }
}
