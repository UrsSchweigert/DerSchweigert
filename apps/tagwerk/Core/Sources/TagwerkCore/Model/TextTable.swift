import Foundation

/// The two languages of every user-visible text.
public enum Language: String, Codable, Sendable, Equatable, CaseIterable {
    /// German.
    case de
    /// English.
    case en
}

/// A key-to-text table with one entry per language; user-visible text lives in Core, in both languages.
public struct TextTable: Codable, Sendable, Equatable {
    /// One key's texts; a nil or empty text counts as missing.
    public struct Entry: Codable, Sendable, Equatable {
        /// German text.
        public var de: String?
        /// English text.
        public var en: String?
        /// Creates an entry.
        public init(de: String?, en: String?) { self.de = de; self.en = en }
    }

    /// The entries by key.
    public var entries: [String: Entry]

    /// Creates a table from entries.
    public init(_ entries: [String: Entry]) { self.entries = entries }

    /// The text for `key` in `language`, or nil when the key or that language is missing or empty.
    public func text(_ key: String, _ language: Language) -> String? {
        let value = language == .de ? entries[key]?.de : entries[key]?.en
        return value?.isEmpty == false ? value : nil
    }

    /// Every (key, language) pair that has no text, sorted; empty when the table is complete.
    public var missing: [String] {
        entries.keys.sorted().flatMap { key in
            Language.allCases.filter { text(key, $0) == nil }.map { "\(key).\($0.rawValue)" }
        }
    }
}
