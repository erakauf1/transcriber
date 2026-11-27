import SwiftUI

extension View {
    func card(padding: CGFloat = 14) -> some View {
        self.padding(padding)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .opacity(configuration.isPressed || !isEnabled ? 0.6 : 1)
    }
}

// 48pt rather than 44 so it lines up with PrimaryButtonStyle in the Result bottom bar.
struct IconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .labelStyle(.iconOnly)
            .font(.body.weight(.medium))
            .foregroundStyle(Color.accentColor)
            .frame(width: 48, height: 48)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

struct ChipButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline)
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
            .overlay(Capsule().strokeBorder(Color(.separator)))
            .opacity(configuration.isPressed ? 0.6 : isEnabled ? 1 : 0.4)
    }
}

struct MetaRow: View {
    var leading = Text("")
    var trailing = Text("")
    var body: some View {
        HStack {
            leading
            Spacer()
            trailing
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .environment(\.layoutDirection, .leftToRight)
        .padding(.horizontal, 4)
    }
}

func formatDuration(_ seconds: TimeInterval) -> String {
    Duration.seconds(seconds.rounded()).formatted(.time(pattern: .minuteSecond))
}
