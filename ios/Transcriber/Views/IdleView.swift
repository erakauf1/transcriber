import SwiftUI

struct IdleView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Button {
                Task { await model.startRecording() }
            } label: {
                Image(systemName: "mic.fill").font(.system(size: 48)).frame(width: 120, height: 120)
            }
            .buttonStyle(.borderedProminent).clipShape(Circle())
            .disabled(!model.settings.hasOpenAIKey)
            if !model.settings.hasOpenAIKey {
                Text("Add your OpenAI key in Settings to start.").foregroundStyle(.secondary)
            }
            if let banner = model.banner {
                Text(banner).foregroundStyle(.red).multilineTextAlignment(.center)
                if model.micDenied, let url = URL(string: UIApplication.openSettingsURLString) {
                    Button("Open Settings") { UIApplication.shared.open(url) }
                }
            }
            Spacer()
        }
    }
}
