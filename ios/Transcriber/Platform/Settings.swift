import Foundation
import Observation
import TranscriberCore

@MainActor @Observable
final class Settings {
    var openAIKey: String { didSet { Keychain.setString(openAIKey, for: "openai_api_key") } }
    var anthropicKey: String { didSet { Keychain.setString(anthropicKey, for: "anthropic_api_key") } }
    var openRouterKey: String { didSet { Keychain.setString(openRouterKey, for: "openrouter_api_key") } }

    var cleanupProvider: Provider { didSet { defaults.set(cleanupProvider.rawValue, forKey: "cleanup_provider") } }
    var refineProvider: Provider { didSet { defaults.set(refineProvider.rawValue, forKey: "refine_provider") } }
    var cleanupOpenRouterModel: String { didSet { defaults.set(cleanupOpenRouterModel, forKey: "cleanup_model") } }
    var refineOpenRouterModel: String { didSet { defaults.set(refineOpenRouterModel, forKey: "refine_model") } }
    var cleanupAnthropicModel: String { didSet { defaults.set(cleanupAnthropicModel, forKey: "cleanup_anthropic_model") } }
    var refineAnthropicModel: String { didSet { defaults.set(refineAnthropicModel, forKey: "refine_anthropic_model") } }

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        openAIKey = Keychain.string(for: "openai_api_key") ?? ""
        anthropicKey = Keychain.string(for: "anthropic_api_key") ?? ""
        openRouterKey = Keychain.string(for: "openrouter_api_key") ?? ""
        func provider(_ key: String, _ fallback: Provider) -> Provider {
            defaults.string(forKey: key).flatMap(Provider.init(rawValue:)) ?? fallback
        }
        cleanupProvider = provider("cleanup_provider", ModelDefaults.cleanupProvider)
        refineProvider = provider("refine_provider", ModelDefaults.refineProvider)
        cleanupOpenRouterModel = defaults.string(forKey: "cleanup_model") ?? ModelDefaults.openRouter
        refineOpenRouterModel = defaults.string(forKey: "refine_model") ?? ModelDefaults.openRouter
        cleanupAnthropicModel = defaults.string(forKey: "cleanup_anthropic_model") ?? ModelDefaults.anthropic
        refineAnthropicModel = defaults.string(forKey: "refine_anthropic_model") ?? ModelDefaults.anthropic
    }

    var hasOpenAIKey: Bool { !openAIKey.isEmpty }

    func key(for provider: Provider) -> String {
        switch provider { case .openai: openAIKey; case .anthropic: anthropicKey; case .openrouter: openRouterKey }
    }

    func cleanupStep() -> StepConfig {
        StepConfig(provider: cleanupProvider,
                   model: resolveModel(provider: cleanupProvider, openRouterModel: cleanupOpenRouterModel, anthropicModel: cleanupAnthropicModel),
                   apiKey: key(for: cleanupProvider))
    }

    func refineStep() -> StepConfig {
        StepConfig(provider: refineProvider,
                   model: resolveModel(provider: refineProvider, openRouterModel: refineOpenRouterModel, anthropicModel: refineAnthropicModel),
                   apiKey: key(for: refineProvider))
    }
}
