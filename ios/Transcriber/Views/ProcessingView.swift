import SwiftUI

struct ProcessingView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(spacing: 16) {
            if let error = model.state.error, model.state.phase == .transcribing {
                Text(error).foregroundStyle(.red).multilineTextAlignment(.center)
                Button("Retry") { model.retryTranscription() }.buttonStyle(.borderedProminent)
                Button("Discard", role: .destructive) { model.reset() }
                Text("The recording is saved in History, so you can retry later.").font(.footnote).foregroundStyle(.secondary)
            } else {
                ProgressView()
                Text(model.state.phase == .transcribing ? "Transcribing…" : "Cleaning up…").foregroundStyle(.secondary)
            }
        }
    }
}
