import AppKit
import Foundation
import SwiftUI

// MARK: - 播放模式与顶部形态

enum PlayMode: String, Codable, CaseIterable {
    case repeatAll = "repeat-all"
    case repeatOne = "repeat-one"
    case shuffle = "shuffle"

    var iconName: String {
        switch self {
        case .repeatAll: return "repeat"
        case .repeatOne: return "repeat.1"
        case .shuffle: return "shuffle"
        }
    }

    var label: String {
        switch self {
        case .repeatAll: return "列表循环"
        case .repeatOne: return "单曲循环"
        case .shuffle: return "随机播放"
        }
    }

    func next() -> PlayMode {
        let all = Self.allCases
        let idx = all.firstIndex(of: self) ?? 0
        return all[(idx + 1) % all.count]
    }
}

enum IslandFormMode: String, Codable, CaseIterable {
    case auto = "auto"
    case notchMerged = "notch"
    case floatingCapsule = "capsule"

    var label: String {
        switch self {
        case .auto: return "自动检测"
        case .notchMerged: return "刘海融合"
        case .floatingCapsule: return "无刘海胶囊"
        }
    }
}

// MARK: - 网页端 → macOS 灵动岛协议模型

struct IslandTrack: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let titleExtra: String?
    let artists: [String]
    let displayArtists: [String]?
    let inlineTitle: String
    let album: String
    let albumPic: String?
    /// 曲目总时长（严格为毫秒 ms）
    var durationMs: Double

    enum CodingKeys: String, CodingKey {
        case id, name, artists, album
        case titleExtra = "title_extra"
        case displayArtists = "display_artists"
        case inlineTitle = "inline_title"
        case albumPic = "album_pic"
        case durationMs = "duration_ms"
        case legacyDuration = "duration"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        titleExtra = try c.decodeIfPresent(String.self, forKey: .titleExtra)
        artists = try c.decodeIfPresent([String].self, forKey: .artists) ?? []
        displayArtists = try c.decodeIfPresent([String].self, forKey: .displayArtists)
        inlineTitle = try c.decodeIfPresent(String.self, forKey: .inlineTitle) ?? name
        album = try c.decodeIfPresent(String.self, forKey: .album) ?? ""
        albumPic = try c.decodeIfPresent(String.self, forKey: .albumPic)
        durationMs = try c.decodeIfPresent(Double.self, forKey: .durationMs)
            ?? (try c.decodeIfPresent(Double.self, forKey: .legacyDuration) ?? 0)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encodeIfPresent(titleExtra, forKey: .titleExtra)
        try c.encode(artists, forKey: .artists)
        try c.encodeIfPresent(displayArtists, forKey: .displayArtists)
        try c.encode(inlineTitle, forKey: .inlineTitle)
        try c.encode(album, forKey: .album)
        try c.encodeIfPresent(albumPic, forKey: .albumPic)
        try c.encode(durationMs, forKey: .durationMs)
    }

    var artistSubtitle: String {
        let list = (displayArtists?.isEmpty == false ? displayArtists! : artists).joined(separator: " / ")
        return [list, album].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

struct PlaylistTrackItem: Codable, Equatable, Identifiable {
    let index: Int
    let id: Int
    let name: String
    let aliases: [String]
    let titleExtra: String?
    let artists: String
    let album: String
    let albumPic: String?
    /// 曲目总时长（严格为毫秒 ms）
    let durationMs: Double

    enum CodingKeys: String, CodingKey {
        case index, id, name, aliases, artists, album
        case titleExtra = "title_extra"
        case albumPic = "album_pic"
        case durationMs = "duration_ms"
        case legacyDuration = "duration"
    }

    init(
        index: Int,
        id: Int,
        name: String,
        aliases: [String] = [],
        titleExtra: String? = nil,
        artists: String,
        album: String,
        albumPic: String? = nil,
        durationMs: Double = 0
    ) {
        self.index = index
        self.id = id
        self.name = name
        self.aliases = aliases
        self.titleExtra = titleExtra
        self.artists = artists
        self.album = album
        self.albumPic = albumPic
        self.durationMs = durationMs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.decode(Int.self, forKey: .index)
        id = try c.decode(Int.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        aliases = try c.decodeIfPresent([String].self, forKey: .aliases) ?? []
        titleExtra = try c.decodeIfPresent(String.self, forKey: .titleExtra)
        artists = try c.decodeIfPresent(String.self, forKey: .artists) ?? ""
        album = try c.decodeIfPresent(String.self, forKey: .album) ?? ""
        albumPic = try c.decodeIfPresent(String.self, forKey: .albumPic)
        durationMs = try c.decodeIfPresent(Double.self, forKey: .durationMs)
            ?? (try c.decodeIfPresent(Double.self, forKey: .legacyDuration) ?? 0)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(index, forKey: .index)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        if !aliases.isEmpty {
            try c.encode(aliases, forKey: .aliases)
        }
        try c.encodeIfPresent(titleExtra, forKey: .titleExtra)
        try c.encode(artists, forKey: .artists)
        try c.encode(album, forKey: .album)
        try c.encodeIfPresent(albumPic, forKey: .albumPic)
        try c.encode(durationMs, forKey: .durationMs)
    }

    var resolvedTitleExtra: String? {
        if let extra = titleExtra, !extra.isEmpty {
            return extra
        }
        let valid = aliases.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && $0.caseInsensitiveCompare(name) != .orderedSame }
        return valid.isEmpty ? nil : valid.joined(separator: " / ")
    }

    var subtitle: String {
        [artists, album].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var formattedDuration: String? {
        guard durationMs >= 1000 else { return nil }
        let totalSec = Int(floor(durationMs / 1000.0))
        return String(format: "%02d:%02d", totalSec / 60, totalSec % 60)
    }
}

/// 1:1 对齐前端 `web/src/components/music-page/playlist-filter.ts`：
/// 支持歌名、别名、歌手、专辑与歌曲 ID 检索，统一全半角/大小写与平片假名，支持空格多关键词与权重相关度排序
enum PlaylistSearchFilter {
    private static let nameWeight = 100
    private static let aliasWeight = 80
    private static let artistWeight = 60
    private static let albumWeight = 40
    private static let exactBonus = 30
    private static let prefixBonus = 15
    private static let idScore = 10_000

    struct SearchField {
        let text: String
        let weight: Int
    }

    static func normalize(_ text: String) -> String {
        guard !text.isEmpty else { return "" }
        let nfkc = text.precomposedStringWithCompatibilityMapping.lowercased()
        var scalars = String.UnicodeScalarView()
        scalars.reserveCapacity(nfkc.unicodeScalars.count)
        for scalar in nfkc.unicodeScalars {
            let v = scalar.value
            // 片假名 (U+30A1...U+30F6) 统一折算为平假名 (-0x60)
            let mapped: UnicodeScalar
            if v >= 0x30A1 && v <= 0x30F6, let hira = UnicodeScalar(v - 0x60) {
                mapped = hira
            } else {
                mapped = scalar
            }
            if CharacterSet.whitespacesAndNewlines.contains(mapped)
                || CharacterSet.punctuationCharacters.contains(mapped)
                || CharacterSet.symbols.contains(mapped) {
                continue
            }
            scalars.append(mapped)
        }
        return String(scalars)
    }

    private static func fields(for item: PlaylistTrackItem) -> [SearchField] {
        var raw: [(String, Int)] = [(item.name, nameWeight)]
        for alias in item.aliases {
            raw.append((alias, aliasWeight))
        }
        if let extra = item.titleExtra, !extra.isEmpty {
            raw.append((extra, aliasWeight))
        }
        for artist in item.artists.components(separatedBy: "/") {
            raw.append((artist, artistWeight))
        }
        raw.append((item.album, albumWeight))

        return raw.compactMap { text, weight in
            let norm = normalize(text)
            return norm.isEmpty ? nil : SearchField(text: norm, weight: weight)
        }
    }

    private static func tokenScore(normToken: String, rawToken: String, item: PlaylistTrackItem, fields: [SearchField]) -> Int {
        if !rawToken.isEmpty, rawToken.allSatisfy(\.isWholeNumber), String(item.id) == rawToken {
            return idScore
        }
        guard !normToken.isEmpty else { return 0 }
        var best = 0
        for field in fields where field.text.contains(normToken) {
            let bonus = (field.text == normToken)
                ? exactBonus
                : (field.text.hasPrefix(normToken) ? prefixBonus : 0)
            best = max(best, field.weight + bonus)
        }
        return best
    }

    static func filter(_ playlist: [PlaylistTrackItem], query: String) -> [PlaylistTrackItem] {
        let tokens = query
            .split(whereSeparator: \.isWhitespace)
            .map { rawSub -> (raw: String, norm: String) in
                let raw = String(rawSub)
                return (raw, normalize(raw))
            }
            .filter { !$0.norm.isEmpty || (!$0.raw.isEmpty && $0.raw.allSatisfy(\.isWholeNumber)) }

        guard !tokens.isEmpty else { return playlist }

        var scored: [(item: PlaylistTrackItem, score: Int)] = []
        scored.reserveCapacity(min(playlist.count, 64))

        for item in playlist {
            let itemFields = fields(for: item)
            var total = 0
            for token in tokens {
                let s = tokenScore(normToken: token.norm, rawToken: token.raw, item: item, fields: itemFields)
                if s == 0 {
                    total = 0
                    break
                }
                total += s
            }
            if total > 0 {
                scored.append((item, total))
            }
        }

        scored.sort { lhs, rhs in
            if lhs.score != rhs.score {
                return lhs.score > rhs.score
            }
            return lhs.item.index < rhs.item.index
        }
        return scored.map(\.item)
    }
}

struct TimeIntervalRange: Codable, Equatable {
    let start: Double
    let end: Double
}

struct LyricRubyPayload: Codable, Equatable {
    let text: String
    let start: Double
    let end: Double
}

struct LyricRomanWordPayload: Codable, Equatable {
    let text: String
    let start: Double
    let end: Double
    let word: Int
}

struct LyricWordPayload: Codable, Equatable {
    let text: String
    let start: Double
    let end: Double
    let ruby: [LyricRubyPayload]?

    init(text: String, start: Double, end: Double, ruby: [LyricRubyPayload]? = nil) {
        self.text = text
        self.start = start
        self.end = end
        self.ruby = ruby
    }
}

struct LyricSpritePathPayload: Codable, Equatable {
    let d: String
    let paint: String
}

struct LyricSpritePayload: Codable, Equatable {
    let name: String
    let paths: [LyricSpritePathPayload]
    let motion: String
    let size: String
    let spin: Bool
    let colorHex: String

    enum CodingKeys: String, CodingKey {
        case name, paths, motion, size, spin
        case colorHex = "color_hex"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        paths = try c.decodeIfPresent([LyricSpritePathPayload].self, forKey: .paths) ?? []
        motion = try c.decodeIfPresent(String.self, forKey: .motion) ?? "fall"
        size = try c.decodeIfPresent(String.self, forKey: .size) ?? "m"
        spin = try c.decodeIfPresent(Bool.self, forKey: .spin) ?? false
        colorHex = try c.decodeIfPresent(String.self, forKey: .colorHex) ?? "#ffffff"
    }
}

struct LyricEmphasisPayload: Codable, Equatable {
    let from: Int
    let to: Int
    let start: Double
    let end: Double
    let factor: Double
    let effect: String
    let colorHex: String?
    let font: String?
    let styles: [String]
    let hold: TimeIntervalRange?

    enum CodingKeys: String, CodingKey {
        case from, to, start, end, factor, effect, font, styles, hold
        case colorHex = "color_hex"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decode(Int.self, forKey: .from)
        to = try c.decode(Int.self, forKey: .to)
        start = try c.decode(Double.self, forKey: .start)
        end = try c.decode(Double.self, forKey: .end)
        factor = try c.decode(Double.self, forKey: .factor)
        effect = try c.decode(String.self, forKey: .effect)
        colorHex = try c.decodeIfPresent(String.self, forKey: .colorHex)
        font = try c.decodeIfPresent(String.self, forKey: .font)
        styles = try c.decodeIfPresent([String].self, forKey: .styles) ?? []
        hold = try c.decodeIfPresent(TimeIntervalRange.self, forKey: .hold)
    }
}

struct SingerColorDot: Identifiable, Equatable {
    let id: String
    let hex: String
}

struct LyricLinePayload: Codable, Equatable {
    let start: Double
    let end: Double
    let isDuet: Bool
    let isBackground: Bool
    let align: String
    let owner: Int
    let paragraphStart: Bool
    let backgroundPosition: String?
    let chorusStart: Bool
    let edgeColors: [String]?
    let singerName: String?
    let singerDotOnly: Bool
    let translation: String?
    let secondaryTranslation: String?
    let romanization: String?
    let romanizationWords: [LyricRomanWordPayload]
    let moodHex: String?
    let scene: String?
    let sceneColorHex: String?
    let sceneLines: Int?
    let words: [LyricWordPayload]
    let emphasis: [LyricEmphasisPayload]
    /// 解码期一次性预拼装纯文本，避免视图 body 内重复 map + joined 分配内存
    let plainText: String
    /// 是否存在日文汉字上方振假名注音
    let hasFurigana: Bool

    enum CodingKeys: String, CodingKey {
        case start, end, align, owner, translation, romanization, words, emphasis, scene
        case secondaryTranslation = "secondary_translation"
        case romanizationWords = "romanization_words"
        case isDuet = "is_duet"
        case isBackground = "is_background"
        case paragraphStart = "paragraph_start"
        case backgroundPosition = "background_position"
        case chorusStart = "chorus_start"
        case edgeColors = "edge_colors"
        case singerName = "singer_name"
        case singerDotOnly = "singer_dot_only"
        case moodHex = "mood_hex"
        case sceneColorHex = "scene_color_hex"
        case sceneLines = "scene_lines"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        start = try c.decode(Double.self, forKey: .start)
        end = try c.decode(Double.self, forKey: .end)
        isDuet = try c.decodeIfPresent(Bool.self, forKey: .isDuet) ?? false
        isBackground = try c.decodeIfPresent(Bool.self, forKey: .isBackground) ?? false
        align = try c.decodeIfPresent(String.self, forKey: .align) ?? (isDuet ? "right" : "left")
        owner = try c.decodeIfPresent(Int.self, forKey: .owner) ?? -1
        paragraphStart = try c.decodeIfPresent(Bool.self, forKey: .paragraphStart) ?? false
        backgroundPosition = try c.decodeIfPresent(String.self, forKey: .backgroundPosition)
        chorusStart = try c.decodeIfPresent(Bool.self, forKey: .chorusStart) ?? false
        edgeColors = try c.decodeIfPresent([String].self, forKey: .edgeColors)
        singerName = try c.decodeIfPresent(String.self, forKey: .singerName)
        singerDotOnly = try c.decodeIfPresent(Bool.self, forKey: .singerDotOnly) ?? false
        translation = try c.decodeIfPresent(String.self, forKey: .translation)
        secondaryTranslation = try c.decodeIfPresent(String.self, forKey: .secondaryTranslation)
        romanization = try c.decodeIfPresent(String.self, forKey: .romanization)
        romanizationWords = try c.decodeIfPresent([LyricRomanWordPayload].self, forKey: .romanizationWords) ?? []
        moodHex = try c.decodeIfPresent(String.self, forKey: .moodHex)
        scene = try c.decodeIfPresent(String.self, forKey: .scene)
        sceneColorHex = try c.decodeIfPresent(String.self, forKey: .sceneColorHex)
        sceneLines = try c.decodeIfPresent(Int.self, forKey: .sceneLines)
        let decodedWords = try c.decodeIfPresent([LyricWordPayload].self, forKey: .words) ?? []
        words = decodedWords
        emphasis = try c.decodeIfPresent([LyricEmphasisPayload].self, forKey: .emphasis) ?? []
        plainText = decodedWords.map(\.text).joined()
        hasFurigana = decodedWords.contains { ($0.ruby?.isEmpty == false) }
    }

    func emphasisForWord(at wordIndex: Int) -> LyricEmphasisPayload? {
        emphasis.first { wordIndex >= $0.from && wordIndex < $0.to }
    }
}

/// 预绑定稳定跨曲目唯一 ID 的歌词行模型（遵循 swiftui-expert-skill：杜绝 ForEach 使用 \.offset 或可变文本作为 ID）
struct IndexedLyricLine: Identifiable, Equatable {
    let id: String
    let index: Int
    let line: LyricLinePayload
    let singerDots: [SingerColorDot]
}

/// 展开面板多行舞台条目（1:1 对应 timeline.ts TimelineItem：歌词行 + 间奏三圆点 + 底栏歌词来源）
enum StageTimelineEntry: Identifiable, Equatable {
    case line(IndexedLyricLine)
    case interlude(id: String, range: TimeIntervalRange, align: String)
    case footer(id: String, text: String)

    var id: String {
        switch self {
        case .line(let item):
            return item.id
        case .interlude(let id, _, _):
            return id
        case .footer(let id, _):
            return id
        }
    }
}

struct LyricNotePayload: Codable, Equatable {
    let start: Double
    let content: String
    let source: String
    let liked: Int?
}

struct LyricOutroPayload: Codable, Equatable {
    let content: String
    let liked: Int
}

struct LyricsBundlePayload: Codable, Equatable {
    let source: String
    let sourceName: String?
    let font: String?
    let motion: String?
    let wordSynced: Bool
    let instrumental: Bool
    let spotlights: [Int]
    let sprites: [String: LyricSpritePayload]
    let intro: String?
    let outro: LyricOutroPayload?
    let notes: [LyricNotePayload]
    let interludes: [TimeIntervalRange]
    let lines: [LyricLinePayload]

    enum CodingKeys: String, CodingKey {
        case source, font, motion, instrumental, spotlights, sprites, intro, outro, notes, interludes, lines
        case sourceName = "source_name"
        case wordSynced = "word_synced"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "none"
        sourceName = try c.decodeIfPresent(String.self, forKey: .sourceName)
        font = try c.decodeIfPresent(String.self, forKey: .font)
        motion = try c.decodeIfPresent(String.self, forKey: .motion)
        wordSynced = try c.decodeIfPresent(Bool.self, forKey: .wordSynced) ?? false
        instrumental = try c.decodeIfPresent(Bool.self, forKey: .instrumental) ?? false
        spotlights = try c.decodeIfPresent([Int].self, forKey: .spotlights) ?? []
        sprites = try c.decodeIfPresent([String: LyricSpritePayload].self, forKey: .sprites) ?? [:]
        intro = try c.decodeIfPresent(String.self, forKey: .intro)
        outro = try c.decodeIfPresent(LyricOutroPayload.self, forKey: .outro)
        notes = try c.decodeIfPresent([LyricNotePayload].self, forKey: .notes) ?? []
        interludes = try c.decodeIfPresent([TimeIntervalRange].self, forKey: .interludes) ?? []
        lines = try c.decodeIfPresent([LyricLinePayload].self, forKey: .lines) ?? []
    }

    init(
        source: String,
        sourceName: String? = nil,
        font: String?,
        motion: String? = nil,
        wordSynced: Bool,
        instrumental: Bool,
        spotlights: [Int],
        sprites: [String: LyricSpritePayload] = [:],
        intro: String? = nil,
        outro: LyricOutroPayload? = nil,
        notes: [LyricNotePayload] = [],
        interludes: [TimeIntervalRange],
        lines: [LyricLinePayload]
    ) {
        self.source = source
        self.sourceName = sourceName
        self.font = font
        self.motion = motion
        self.wordSynced = wordSynced
        self.instrumental = instrumental
        self.spotlights = spotlights
        self.sprites = sprites
        self.intro = intro
        self.outro = outro
        self.notes = notes
        self.interludes = interludes
        self.lines = lines
    }

    /// 1:1 对齐 lyricSourceLabel + lyric_footer：舞台底部歌词来源标注
    var footerLabel: String? {
        guard source != "none" else { return nil }
        if let custom = sourceName, !custom.isEmpty {
            return "歌词来自 \(custom)"
        }
        let name: String? = {
            switch source {
            case "ncm-yrc", "ncm-lrc": return "网易云音乐"
            case "qq-qrc", "qq-lrc": return "QQ 音乐"
            case "kugou-krc", "kugou-lrc": return "酷狗音乐"
            case "ttml-amll": return "AMLL TTML 歌词库"
            case "ttml-custom": return "自定义歌词源"
            default: return nil
            }
        }()
        return name.map { "歌词来自 \($0)" }
    }

    /// 是否为多声部曲目（存在对唱、合唱或多位歌手色条）
    var isMultiVocal: Bool {
        lines.contains { !$0.isBackground && ($0.isDuet || $0.align != "left" || ($0.edgeColors?.isEmpty == false)) }
    }

    static let empty = LyricsBundlePayload(
        source: "none",
        font: nil,
        wordSynced: false,
        instrumental: false,
        spotlights: [],
        interludes: [],
        lines: []
    )
}

struct IslandGlowPayload: Codable, Equatable {
    let color: String
    let strong: Bool
}

struct TranslationSelectionItem: Codable, Equatable {
    let lang: String
    let preferNative: Bool

    enum CodingKeys: String, CodingKey {
        case lang
        case preferNative = "prefer_native"
    }
}

struct AvailableTranslationLangItem: Codable, Equatable, Identifiable {
    var id: String { lang }
    let lang: String
    let label: String
    let hasAi: Bool
    let hasNative: Bool
    let generating: Bool

    enum CodingKeys: String, CodingKey {
        case lang, label, generating
        case hasAi = "has_ai"
        case hasNative = "has_native"
    }
}

struct IslandLyricPreferences: Codable, Equatable {
    var showTranslation: Bool
    var canToggleTranslation: Bool
    var translationsGenerating: Bool
    var translationSelections: [TranslationSelectionItem]
    var availableTranslationLangs: [AvailableTranslationLangItem]
    var showRomaji: Bool
    var canToggleRomaji: Bool
    var pronunciationsGenerating: Bool
    var showLyricEffects: Bool
    var showLyricMoments: Bool

    enum CodingKeys: String, CodingKey {
        case showTranslation = "show_translation"
        case canToggleTranslation = "can_toggle_translation"
        case translationsGenerating = "translations_generating"
        case translationSelections = "translation_selections"
        case availableTranslationLangs = "available_translation_langs"
        case showRomaji = "show_romaji"
        case canToggleRomaji = "can_toggle_romaji"
        case pronunciationsGenerating = "pronunciations_generating"
        case showLyricEffects = "show_lyric_effects"
        case showLyricMoments = "show_lyric_moments"
    }

    init(
        showTranslation: Bool = true,
        canToggleTranslation: Bool = true,
        translationsGenerating: Bool = false,
        translationSelections: [TranslationSelectionItem] = [],
        availableTranslationLangs: [AvailableTranslationLangItem] = [],
        showRomaji: Bool = false,
        canToggleRomaji: Bool = true,
        pronunciationsGenerating: Bool = false,
        showLyricEffects: Bool = true,
        showLyricMoments: Bool = true
    ) {
        self.showTranslation = showTranslation
        self.canToggleTranslation = canToggleTranslation
        self.translationsGenerating = translationsGenerating
        self.translationSelections = translationSelections
        self.availableTranslationLangs = availableTranslationLangs
        self.showRomaji = showRomaji
        self.canToggleRomaji = canToggleRomaji
        self.pronunciationsGenerating = pronunciationsGenerating
        self.showLyricEffects = showLyricEffects
        self.showLyricMoments = showLyricMoments
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        showTranslation = try c.decodeIfPresent(Bool.self, forKey: .showTranslation) ?? true
        canToggleTranslation = try c.decodeIfPresent(Bool.self, forKey: .canToggleTranslation) ?? true
        translationsGenerating = try c.decodeIfPresent(Bool.self, forKey: .translationsGenerating) ?? false
        translationSelections = try c.decodeIfPresent([TranslationSelectionItem].self, forKey: .translationSelections) ?? []
        availableTranslationLangs = try c.decodeIfPresent([AvailableTranslationLangItem].self, forKey: .availableTranslationLangs) ?? []
        showRomaji = try c.decodeIfPresent(Bool.self, forKey: .showRomaji) ?? false
        canToggleRomaji = try c.decodeIfPresent(Bool.self, forKey: .canToggleRomaji) ?? true
        pronunciationsGenerating = try c.decodeIfPresent(Bool.self, forKey: .pronunciationsGenerating) ?? false
        showLyricEffects = try c.decodeIfPresent(Bool.self, forKey: .showLyricEffects) ?? true
        showLyricMoments = try c.decodeIfPresent(Bool.self, forKey: .showLyricMoments) ?? true
    }

    static let `default` = IslandLyricPreferences()
}

struct IslandDisplayConfig: Codable, Equatable {
    var formMode: IslandFormMode
    var expandable: Bool
    var beatBars: Bool
    var chorusGlow: Bool
    var hdr: Bool

    enum CodingKeys: String, CodingKey {
        case formMode = "form_mode"
        case expandable
        case beatBars = "beat_bars"
        case chorusGlow = "chorus_glow"
        case hdr
    }

    init(
        formMode: IslandFormMode = .floatingCapsule,
        expandable: Bool = true,
        beatBars: Bool = true,
        chorusGlow: Bool = true,
        hdr: Bool = true
    ) {
        self.formMode = formMode
        self.expandable = expandable
        self.beatBars = beatBars
        self.chorusGlow = chorusGlow
        self.hdr = hdr
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        formMode = try c.decodeIfPresent(IslandFormMode.self, forKey: .formMode) ?? .floatingCapsule
        expandable = try c.decodeIfPresent(Bool.self, forKey: .expandable) ?? true
        beatBars = try c.decodeIfPresent(Bool.self, forKey: .beatBars) ?? true
        chorusGlow = try c.decodeIfPresent(Bool.self, forKey: .chorusGlow) ?? true
        hdr = try c.decodeIfPresent(Bool.self, forKey: .hdr) ?? true
    }

    static let `default` = IslandDisplayConfig()
}

// MARK: - WebSocket 入站与出站帧

struct PreloadedTrackBundle: Codable, Equatable {
    let track: IslandTrack
    let accentHex: String?
    let chorus: [TimeIntervalRange]?
    let lyrics: LyricsBundlePayload?

    enum CodingKeys: String, CodingKey {
        case track, chorus, lyrics
        case accentHex = "accent_hex"
    }
}

struct WebPreloadMessage: Codable {
    let type: String
    let tabId: String?
    let nextTrackId: Int?
    let prevTrackId: Int?
    let items: [PreloadedTrackBundle]

    enum CodingKeys: String, CodingKey {
        case type, items
        case tabId = "tab_id"
        case nextTrackId = "next_track_id"
        case prevTrackId = "prev_track_id"
    }
}

struct WebMediaMessage: Codable {
    let type: String
    let tabId: String?
    let track: IslandTrack?
    let accentHex: String?
    let chorus: [TimeIntervalRange]?
    let lyrics: LyricsBundlePayload?

    enum CodingKeys: String, CodingKey {
        case type, track, chorus, lyrics
        case tabId = "tab_id"
        case accentHex = "accent_hex"
    }
}

struct RhythmDataPayload: Codable {
    let reliable: Bool
    let basePeriodMs: Double
    let trains: [String: [[Double]]]

    enum CodingKeys: String, CodingKey {
        case reliable, trains
        case basePeriodMs = "base_period_ms"
    }

    func toEngineContext() -> RhythmEngineContext {
        guard reliable else { return .fallback }
        var map: [Int: [RhythmPulsePoint]] = [:]
        for (kStr, arr) in trains {
            if let oct = Int(kStr) {
                map[oct] = arr.compactMap { pair in
                    guard pair.count >= 2 else { return nil }
                    return RhythmPulsePoint(t: pair[0], a: pair[1])
                }
            }
        }
        return RhythmEngineContext(reliable: true, basePeriodMs: max(120, basePeriodMs), trains: map)
    }
}

struct WebRhythmMessage: Codable {
    let type: String
    let tabId: String?
    let trackId: Int?
    let rhythm: RhythmDataPayload

    enum CodingKeys: String, CodingKey {
        case type, rhythm
        case tabId = "tab_id"
        case trackId = "track_id"
    }
}

struct WebPlaylistMessage: Codable {
    let type: String
    let tabId: String?
    let complete: Bool
    let currentIndex: Int?
    let tracks: [PlaylistTrackItem]

    enum CodingKeys: String, CodingKey {
        case type, complete, tracks
        case tabId = "tab_id"
        case currentIndex = "current_index"
    }
}

struct WebStateMessage: Codable {
    let type: String
    let tabId: String?
    let visible: Bool
    let hasPlayed: Bool
    let showPlaying: Bool
    let isPlaying: Bool
    let pendingStep: Int?
    let trackId: Int?
    let lyricStatus: String
    let lyricSourcesPending: Bool
    let durationMs: Double?
    let positionMs: Double
    let seekAtMs: Double?
    let anchorMs: Double
    let playMode: PlayMode
    let volume: Double
    let muted: Bool
    let peekText: String?
    let pausedText: String?
    let glow: IslandGlowPayload?
    let preferences: IslandLyricPreferences
    let config: IslandDisplayConfig

    enum CodingKeys: String, CodingKey {
        case type, visible, volume, muted, glow, preferences, config
        case tabId = "tab_id"
        case hasPlayed = "has_played"
        case showPlaying = "show_playing"
        case isPlaying = "is_playing"
        case pendingStep = "pending_step"
        case trackId = "track_id"
        case lyricStatus = "lyric_status"
        case lyricSourcesPending = "lyric_sources_pending"
        case durationMs = "duration_ms"
        case positionMs = "position_ms"
        case seekAtMs = "seek_at_ms"
        case anchorMs = "anchor_ms"
        case playMode = "play_mode"
        case peekText = "peek_text"
        case pausedText = "paused_text"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        tabId = try c.decodeIfPresent(String.self, forKey: .tabId)
        visible = try c.decode(Bool.self, forKey: .visible)
        hasPlayed = try c.decodeIfPresent(Bool.self, forKey: .hasPlayed) ?? false
        showPlaying = try c.decode(Bool.self, forKey: .showPlaying)
        isPlaying = try c.decode(Bool.self, forKey: .isPlaying)
        pendingStep = try c.decodeIfPresent(Int.self, forKey: .pendingStep)
        trackId = try c.decodeIfPresent(Int.self, forKey: .trackId)
        lyricStatus = try c.decodeIfPresent(String.self, forKey: .lyricStatus) ?? "ready"
        lyricSourcesPending = try c.decodeIfPresent(Bool.self, forKey: .lyricSourcesPending) ?? false
        durationMs = try c.decodeIfPresent(Double.self, forKey: .durationMs)
        positionMs = try c.decode(Double.self, forKey: .positionMs)
        seekAtMs = try c.decodeIfPresent(Double.self, forKey: .seekAtMs)
        anchorMs = try c.decode(Double.self, forKey: .anchorMs)
        playMode = try c.decodeIfPresent(PlayMode.self, forKey: .playMode) ?? .repeatAll
        volume = try c.decodeIfPresent(Double.self, forKey: .volume) ?? 1.0
        muted = try c.decodeIfPresent(Bool.self, forKey: .muted) ?? false
        peekText = try c.decodeIfPresent(String.self, forKey: .peekText)
        pausedText = try c.decodeIfPresent(String.self, forKey: .pausedText)
        glow = try c.decodeIfPresent(IslandGlowPayload.self, forKey: .glow)
        preferences = try c.decodeIfPresent(IslandLyricPreferences.self, forKey: .preferences) ?? .default
        config = try c.decodeIfPresent(IslandDisplayConfig.self, forKey: .config) ?? .default
    }
}

struct OutgoingCommand: Codable {
    let action: String
    var positionMs: Double? = nil
    var index: Int? = nil
    var playMode: PlayMode? = nil
    var volume: Double? = nil
    var lang: String? = nil
    var preferNative: Bool? = nil
    var hasDualSources: Bool? = nil
    var focusToken: String? = nil

    enum CodingKeys: String, CodingKey {
        case action, index, volume, lang
        case positionMs = "position_ms"
        case playMode = "play_mode"
        case preferNative = "prefer_native"
        case hasDualSources = "has_dual_sources"
        case focusToken = "focus_token"
    }
}

struct OutgoingEnvelope: Codable {
    let type: String
    let command: OutgoingCommand
}

// MARK: - 颜色解析与原生线性 EDR 超白高光

extension Color {
    static func parseRGBComponents(_ raw: String?) -> (r: Double, g: Double, b: Double) {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return (0.38, 0.65, 0.98)
        }
        if raw.hasPrefix("#") {
            let trimmed = String(raw.dropFirst())
            var int: UInt64 = 0
            Scanner(string: trimmed).scanHexInt64(&int)
            if trimmed.count >= 6 {
                let val = trimmed.count > 6 ? (int >> UInt64((trimmed.count - 6) * 4)) : int
                return (
                    Double((val >> 16) & 0xFF) / 255.0,
                    Double((val >> 8) & 0xFF) / 255.0,
                    Double(val & 0xFF) / 255.0
                )
            }
        }
        if raw.lowercased().hasPrefix("rgb") {
            let nums = raw
                .components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted)
                .compactMap(Double.init)
            if nums.count >= 3 {
                return (nums[0] / 255.0, nums[1] / 255.0, nums[2] / 255.0)
            }
        }
        return (0.38, 0.65, 0.98)
    }

    init(cssColor raw: String?) {
        let (r, g, b) = Self.parseRGBComponents(raw)
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
    }

    /// 生成 macOS 原生线性扩展动态范围（EDR）超白颜色（gain > 1.0 时在 XDR 屏突破 SDR 白光上限，0 张 PNG 解码）
    static func edrCss(_ raw: String?, tint: Double = 1.0, gain: Double = 1.0, opacity: Double = 1.0) -> Color {
        let (cr, cg, cb) = parseRGBComponents(raw)
        let r = 1.0 * (1.0 - tint) + cr * tint
        let g = 1.0 * (1.0 - tint) + cg * tint
        let b = 1.0 * (1.0 - tint) + cb * tint
        if gain <= 1.001 {
            return Color(.sRGB, red: r, green: g, blue: b, opacity: opacity)
        }
        // 将 sRGB 转线性空间后乘以物理亮度倍数 gain（对齐 hdr-color.ts 线性增益语义）
        func toLinear(_ c: Double) -> Double {
            c <= 0.04045 ? (c / 12.92) : pow((c + 0.055) / 1.055, 2.4)
        }
        return Color(
            .sRGBLinear,
            red: toLinear(r) * gain,
            green: toLinear(g) * gain,
            blue: toLinear(b) * gain,
            opacity: opacity
        )
    }

    /// 对齐 lyric-player.ts hdrExitEndAlpha：在启用 EDR 超白高光时，对擦除遮罩未唱侧的不透明度做扩展 sRGB 等效亮度补偿，
    /// 保证 progress 从 0 跨入 >0 的瞬间右侧未唱部分亮度与未开唱态严丝合缝，绝不跳亮。
    static func hdrMaskDimAlpha(baseDimAlpha: Double, gain: Double, hdrEnabled: Bool) -> Double {
        let sdrDim = baseDimAlpha * (hdrEnabled ? 0.6 : 1.0)
        guard hdrEnabled, gain > 1.001 else { return sdrDim }
        let esrgb = max(1.0, 1.055 * pow(gain, 1.0 / 2.4) - 0.055)
        return max(0.02, min(1.0, sdrDim / esrgb))
    }
}
