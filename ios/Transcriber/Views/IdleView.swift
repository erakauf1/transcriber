import SwiftUI

struct IdleView: View {
    @Environment(AppModel.self) private var model

    private var canRecord: Bool { model.settings.hasOpenAIKey }

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Button {
                Task { await model.startRecording() }
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 44, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 112, height: 112)
                    .background(Circle().fill(canRecord ? Color.accentColor : Color(.systemGray3)))
                    .shadow(color: canRecord ? Color.accentColor.opacity(0.35) : .clear, radius: 15, y: 8)
            }
            .buttonStyle(.plain)
            .disabled(!canRecord)
            .accessibilityLabel("Record")
            if canRecord {
                Text("Tap to record\nUp to 5 minutes")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            } else {
                Text("Add your OpenAI key in Settings to start.")
                    .font(.subheadline).foregroundStyle(.secondary).card()
            }
            if let banner = model.banner {
                VStack(spacing: 10) {
                    Text(banner).foregroundStyle(.red).multilineTextAlignment(.center)
                    if model.micDenied, let url = URL(string: UIApplication.openSettingsURLString) {
                        Button("Open Settings") { UIApplication.shared.open(url) }
                    }
                }
                .frame(maxWidth: .infinity)
                .card()
            }
            Spacer()
        }
    }
}
