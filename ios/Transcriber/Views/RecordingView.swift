import SwiftUI

struct RecordingView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(spacing: 32) {
            Spacer()
            Text(Duration.seconds(model.elapsed).formatted(.time(pattern: .minuteSecond)))
                .font(.system(size: 48, weight: .light, design: .monospaced))
            HStack(alignment: .center, spacing: 4) {
                ForEach(Array(model.levels.enumerated()), id: \.offset) { _, level in
                    Capsule().frame(width: 6, height: max(6, level * 80))
                }
            }
            .frame(height: 80)
            .foregroundStyle(model.silentStyle ? Color.secondary : Color.accentColor)
            Text("Max 5:00").font(.footnote).foregroundStyle(.secondary)
            Button { model.stopRecording() } label: {
                Image(systemName: "stop.fill").font(.system(size: 40)).frame(width: 100, height: 100)
            }
            .buttonStyle(.borderedProminent).tint(.red).clipShape(Circle())
            Spacer()
        }
    }
}
