import SwiftUI
import TranscriberCore

struct SettingsView: View {
    @Bindable var settings: Settings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("API keys") {
                    SecureField("OpenAI (required)", text: $settings.openAIKey)
                    SecureField("Anthropic", text: $settings.anthropicKey)
                    SecureField("OpenRouter", text: $settings.openRouterKey)
                }
                StepSection(title: "Cleanup", provider: $settings.cleanupProvider,
                            anthropicModel: $settings.cleanupAnthropicModel,
                            openRouterModel: $settings.cleanupOpenRouterModel,
                            hasKey: !settings.key(for: settings.cleanupProvider).isEmpty)
                StepSection(title: "Refine", provider: $settings.refineProvider,
                            anthropicModel: $settings.refineAnthropicModel,
                            openRouterModel: $settings.refineOpenRouterModel,
                            hasKey: !settings.key(for: settings.refineProvider).isEmpty)
                Section {
                    Text("Keys are stored in this iPhone's Keychain and never leave the device.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .navigationTitle("Settings")
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}

private struct StepSection: View {
    let title: String
    @Binding var provider: Provider
    @Binding var anthropicModel: String
    @Binding var openRouterModel: String
    let hasKey: Bool
    @State private var customOpenRouter = false

    var body: some View {
        Section(title) {
            Picker("Provider", selection: $provider) {
                ForEach(Provider.allCases, id: \.self) { Text($0.displayName).tag($0) }
            }
            switch provider {
            case .anthropic:
                Picker("Model", selection: $anthropicModel) {
                    ForEach(ModelDefaults.anthropicModels) { Text($0.label).tag($0.id) }
                }
            case .openrouter:
                Picker("Model", selection: Binding(
                    get: { customOpenRouter ? "custom" : openRouterModel },
                    set: { value in
                        customOpenRouter = value == "custom"
                        if !customOpenRouter { openRouterModel = value }
                    })) {
                    ForEach(ModelDefaults.openRouterModels) { Text($0.label).tag($0.id) }
                    Text("Custom…").tag("custom")
                }
                if customOpenRouter {
                    TextField("Model ID, e.g. vendor/model", text: $openRouterModel)
                }
            case .openai:
                LabeledContent("Model", value: ModelDefaults.openAI)
            }
            if !hasKey {
                Text("Add a \(provider.displayName) key above to use this step.").font(.footnote).foregroundStyle(.orange)
            }
        }
        .onAppear {
            customOpenRouter = !ModelDefaults.openRouterModels.contains { $0.id == openRouterModel }
        }
    }
}
