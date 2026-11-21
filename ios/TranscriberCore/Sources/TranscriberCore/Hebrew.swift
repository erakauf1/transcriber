public enum Hebrew {
    /// Letters Hebrew glues onto the next word (up to two of them).
    public static let prefixes = "בלהוכמש"
    /// Regex character-range body for the Hebrew block, for use inside `[...]`.
    public static let rangePattern = "\\u0590-\\u05FF"
}
