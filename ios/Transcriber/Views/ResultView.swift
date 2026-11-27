import SwiftUI
import TranscriberCore

struct ResultView: View {
    @Environment(AppModel.self) private var model
    @State private var draft = ""
    @FocusState private var editing: Bool

    private var direction: LayoutDirection { model.state.language == .he ? .rightToLeft : .leftToRight }

    private var headerText: String {
        var parts = [whenText]
        if let seconds = model.recordedDuration { parts.append(formatDuration(seconds)) }
        return parts.joined(separator: " · ")
    }

    // A retry from History can reopen a note recorded days ago, so only a fresh one is "Just now".
    private var whenText: String {
        guard let date = model.recordedAt, Date.now.timeIntervalSince(date) > 120 else { return "Just now" }
        return date.formatted(.dateTime.day().month().hour(.twoDigits(amPM: .abbreviated)).minute())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MetaRow(leading: Text(headerText),
                    trailing: model.isCopied && !(editing && draft != model.currentText) ? Text("✓ Copied").foregroundStyle(.green) : Text(""))
            if let error = model.state.error {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Cleanup failed — showing the raw transcript. \(error)").font(.footnote)
                    Button("Retry cleanup") { model.retryCleanup() }.font(.footnote.weight(.semibold))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            // A vertical TextField grows with its text (TextEditor always fills the space it's given).
            TextField("", text: $draft, axis: .vertical)
                .lineLimit(2...14)
                .font(.body)
                .focused($editing)
                .accessibilityLabel("Note text")
                .environment(\.layoutDirection, direction)
                .card()
            MetaRow(leading: Text("Tap text to edit"), trailing: Text(model.costText ?? ""))
            if model.isRefining { ProgressView("Refining…").font(.footnote) }
            if let e = model.refineError ?? model.chipsError { Text(e).font(.footnote).foregroundStyle(.red) }
            if !model.chips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.chips) { chip in
                            Button(chip.label) { Task { await model.applyChip(chip) } }
                                .buttonStyle(ChipButtonStyle())
                                .disabled(model.isRefining)
                        }
                    }
                }
                // On the scroll view itself so a Hebrew row starts at the right edge.
                .environment(\.layoutDirection, direction)
                .scrollClipDisabled()
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                ShareLink(item: model.currentText) { Label("Share", systemImage: "square.and.arrow.up") }
                    .buttonStyle(IconButtonStyle())
                Button(model.isCopied ? "Copy again" : "Copy") { commitDraft(); model.copyCurrent() }
                    .buttonStyle(PrimaryButtonStyle())
                Button { model.reset() } label: { Label("New note", systemImage: "plus") }
                    .buttonStyle(IconButtonStyle())
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
