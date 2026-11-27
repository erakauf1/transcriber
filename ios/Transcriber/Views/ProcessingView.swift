import SwiftUI

struct ProcessingView: View {
    @Environment(AppModel.self) private var model

    private var transcribeFailed: Bool { model.state.error != nil && model.state.phase == .transcribing }

    private var recordedTitle: String {
        model.recordedDuration.map { "Recorded · \(formatDuration($0))" } ?? "Recorded"
    }

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            VStack(spacing: 0) {
                StepRow(title: recordedTitle, state: .done)
                Divider()
                StepRow(title: "Transcribing", state: transcribeFailed ? .failed
                        : model.state.phase == .transcribing ? .active : .done)
                Divider()
                StepRow(title: "Cleaning up", state: model.state.phase == .cleaning ? .active : .pending)
            }
            .padding(.horizontal, 14).padding(.vertical, 4)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if transcribeFailed, let error = model.state.error {
                Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                Button("Retry") { model.retryTranscription() }.buttonStyle(PrimaryButtonStyle())
                Button("Later") { model.reset() }
                Text("The recording is saved in History, so you can retry later.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            } else {
                Text("You can leave the app.\nThe result will be copied.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Spacer()
        }
    }
}

private enum StepState { case done, active, pending, failed }

private struct StepRow: View {
    let title: String
    let state: StepState

    var body: some View {
        HStack(spacing: 12) {
            icon.frame(width: 22, height: 22)
            Text(title)
                .fontWeight(state == .active ? .semibold : .regular)
                .foregroundStyle(state == .pending ? .secondary : .primary)
            Spacer()
        }
        .padding(.vertical, 12)
    }

    @ViewBuilder private var icon: some View {
        switch state {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .active: ProgressView().controlSize(.small)
        case .pending: Image(systemName: "circle").foregroundStyle(.tertiary)
        case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        }
    }
}
