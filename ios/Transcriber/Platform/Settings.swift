import Foundation
import Observation
import TranscriberCore
import UIKit

@MainActor @Observable
final class Settings {
    var openAIKey: String { didSet { keyEdited(openAIKey, "openai_api_key") } }
    var anthropicKey: String { didSet { keyEdited(anthropicKey, "anthropic_api_key") } }
    var openRouterKey: String { didSet { keyEdited(openRouterKey, "openrouter_api_key") } }

    var cleanupProvider: Provider { didSet { defaults.set(cleanupProvider.rawValue, forKey: "cleanup_provider") } }
    var refineProvider: Provider { didSet { defaults.set(refineProvider.rawValue, forKey: "refine_provider") } }
    var cleanupOpenRouterModel: String { didSet { defaults.set(cleanupOpenRouterModel, forKey: "cleanup_model") } }
    var refineOpenRouterModel: String { didSet { defaults.set(refineOpenRouterModel, forKey: "refine_model") } }
    var cleanupAnthropicModel: String { didSet { defaults.set(cleanupAnthropicModel, forKey: "cleanup_anthropic_model") } }
    var refineAnthropicModel: String { didSet { defaults.set(refineAnthropicModel, forKey: "refine_anthropic_model") } }

    @ObservationIgnored private let defaults: UserDefaults
    // Accounts whose Keychain read failed (e.g. a launch while locked): their "" is a placeholder, not an empty key.
    @ObservationIgnored private var unavailableAccounts: Set<String> = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        var unavailable: Set<String> = []
        func load(_ account: String) -> String {
            switch Keychain.read(account) {
            case .found(let data): return String(data: data, encoding: .utf8) ?? ""
            case .notFound: return ""
            case .unavailable: unavailable.insert(account); return ""
            }
        }
        openAIKey = load("openai_api_key")
        anthropicKey = load("anthropic_api_key")
        openRouterKey = load("openrouter_api_key")
        unavailableAccounts = unavailable
        func provider(_ key: String, _ fallback: Provider) -> Provider {
            defaults.string(forKey: key).flatMap(Provider.init(rawValue:)) ?? fallback
        }
        cleanupProvider = provider("cleanup_provider", ModelDefaults.cleanupProvider)
        refineProvider = provider("refine_provider", ModelDefaults.refineProvider)
        cleanupOpenRouterModel = defaults.string(forKey: "cleanup_model") ?? ModelDefaults.openRouter
        refineOpenRouterModel = defaults.string(forKey: "refine_model") ?? ModelDefaults.openRouter
        cleanupAnthropicModel = defaults.string(forKey: "cleanup_anthropic_model") ?? ModelDefaults.anthropic
        refineAnthropicModel = defaults.string(forKey: "refine_anthropic_model") ?? ModelDefaults.anthropic
        for name in [UIApplication.protectedDataDidBecomeAvailableNotification, UIApplication.didBecomeActiveNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.reloadUnavailableKeys() }
            }
        }
    }

    private func keyEdited(_ value: String, _ account: String) {
        unavailableAccounts.remove(account)
        Keychain.setString(value, for: account)
    }

    func reloadUnavailableKeys() {
        for account in unavailableAccounts {
            switch Keychain.read(account) {
            case .unavailable: continue
            case .notFound: unavailableAccounts.remove(account); continue
            case .found: break
            }
            guard case .found(let data) = Keychain.read(account), let value = String(data: data, encoding: .utf8) else { continue }
            switch account {
            case "openai_api_key": openAIKey = value
            case "anthropic_api_key": anthropicKey = value
            default: openRouterKey = value
            }
        }
    }

    var hasOpenAIKey: Bool { !key(for: .openai).isEmpty }

    func key(for provider: Provider) -> String {
        let raw = switch provider { case .openai: openAIKey; case .anthropic: anthropicKey; case .openrouter: openRouterKey }
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
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
