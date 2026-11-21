public enum Provider: String, Codable, CaseIterable, Sendable {
    case openai, anthropic, openrouter

    public var displayName: String {
        switch self { case .openai: "OpenAI"; case .anthropic: "Anthropic"; case .openrouter: "OpenRouter" }
    }
}

public struct StepConfig: Equatable, Sendable {
    public var provider: Provider
    public var model: String
    public var apiKey: String

    public init(provider: Provider, model: String, apiKey: String) {
        self.provider = provider; self.model = model; self.apiKey = apiKey
    }
}

public struct ModelOption: Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
}

public enum ModelDefaults {
    public static let openAI = "gpt-4o"
    public static let anthropic = "claude-sonnet-5"
    public static let openRouter = "openrouter/auto"
    public static let cleanupProvider = Provider.anthropic
    public static let refineProvider = Provider.openai

    public static let anthropicModels: [ModelOption] = [
        .init(id: "claude-sonnet-5", label: "Claude Sonnet 5"),
        .init(id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5"),
        .init(id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)"),
        .init(id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable, slower)"),
    ]

    public static let openRouterModels: [ModelOption] = [
        .init(id: "openrouter/auto", label: "Auto (let OpenRouter choose)"),
        .init(id: "minimax/minimax-m3:free", label: "MiniMax M3 (free)"),
        .init(id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek v4 Flash"),
        .init(id: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash"),
    ]
}

public func resolveModel(provider: Provider, openRouterModel: String, anthropicModel: String) -> String {
    switch provider {
    case .openrouter: openRouterModel
    case .anthropic: anthropicModel
    case .openai: ModelDefaults.openAI
    }
}
