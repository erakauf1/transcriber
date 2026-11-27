import SwiftUI

struct RecordingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Text("● REC").font(.caption.weight(.semibold)).foregroundStyle(.red)
            Text(formatDuration(model.elapsed))
                .font(.system(size: 44, weight: .light)).monospacedDigit()
            HStack(alignment: .center, spacing: 3) {
                ForEach(Array(model.levels.enumerated()), id: \.offset) { _, level in
                    Capsule().frame(width: 4, height: max(4, level * 70))
                }
            }
            .frame(height: 70)
            .foregroundStyle(model.silentStyle ? Color.secondary : Color.accentColor)
            Text("\(formatDuration(max(0, Recorder.maxDuration - model.elapsed))) left")
                .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            Spacer()
            Button { model.stopRecording() } label: {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(.red)
                    .frame(width: 28, height: 28)
                    .frame(width: 84, height: 84)
                    .background(Circle().fill(Color(.secondarySystemGroupedBackground)))
                    .shadow(color: .black.opacity(0.08), radius: 8, y: 3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop recording")
            .padding(.bottom, 24)
        }
    }
}
