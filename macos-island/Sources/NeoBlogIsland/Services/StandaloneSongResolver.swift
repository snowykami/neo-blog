import Foundation

/// 脱离浏览器独立运行时的后端公开音乐数据拉取与歌词/节拍组装器：
/// - 并发请求 `/api/v1/music/song/:id` 下的公开只读接口（歌词缓存、AI 强调标注、多语言译文、音译、歌手分轨、副歌与节拍脉冲）；
/// - 原生解析 TTML（含振假名 ruby、逐字音译、对唱与 x-bg 背景和声）、YRC、QRC/KRC 与 LRC，叠加 AI 9 种强调特效、聚光灯与 4 八度节拍脉冲列。
enum StandaloneSongResolver {
    struct ResolvedBundle: Sendable {
        let track: IslandTrack
        let accentHex: String?
        let chorus: [TimeIntervalRange]
        let lyrics: LyricsBundlePayload
        let rhythmData: RhythmDataPayload?
        let songLangLabel: String?
        let availableTranslationLangs: [AvailableTranslationLangItem]?
        let translationsGenerating: Bool
        let pronunciationsGenerating: Bool
    }

    private struct APIEnvelope<T: Decodable>: Decodable {
        let data: T?
    }

    private struct BackendTrackDTO: Decodable {
        let id: Int
        let name: String
        let artists: [String]?
        let album: String?
        let album_pic: String?
        let aliases: [String]?
        let duration: Double?
    }

    private struct BackendChorusDTO: Decodable {
        let start: Double
        let end: Double
    }

    private struct BackendLyricPartDTO: Decodable {
        let lyric: String?
    }

    private struct BackendNCMLyricDTO: Decodable {
        let lrc: BackendLyricPartDTO?
        let tlyric: BackendLyricPartDTO?
        let romalrc: BackendLyricPartDTO?
        let yrc: BackendLyricPartDTO?
        let ytlrc: BackendLyricPartDTO?
        let yromalrc: BackendLyricPartDTO?
    }

    private struct BackendTTMLDTO: Decodable {
        let source: String?
        let name: String?
        let ttml: String?
    }

    private struct BackendQQLyricDTO: Decodable {
        let format: String?
        let lyric: String?
        let translation: String?
        let romanization: String?
        let ttml: String?
    }

    private struct BackendLyricCacheDTO: Decodable {
        let kind: String?
        let ncm: BackendNCMLyricDTO?
        let ttml: BackendTTMLDTO?
        let qq: BackendQQLyricDTO?
        let kugou: BackendQQLyricDTO?
    }

    private struct BackendLyricSettingsDTO: Decodable {
        let offsets: [String: Double]?
        let pin: String?
    }

    private struct BackendAnnotationPhraseDTO: Decodable {
        let text: String
        let effect: String
        let color: String?
        let font: String?
        let styles: [String]?
    }

    private struct BackendAnnotationLineDTO: Decodable {
        let text: String
        let mood: String?
        let chorus: Bool?
        let chorus_start: Bool?
        let scene: String?
        let scene_color: String?
        let scene_lines: Int?
        let phrases: [BackendAnnotationPhraseDTO]?
    }

    private struct BackendAnnotationSpotlightDTO: Decodable {
        let text: String
        let occurrence: Int
    }

    private struct BackendAnnotationMomentDTO: Decodable {
        let text: String
        let occurrence: Int
        let content: String
        let source: String
        let liked: Int?
    }

    private struct BackendAnnotationCommentDTO: Decodable {
        let content: String
        let liked: Int?
    }

    private struct BackendSpritePathDTO: Decodable {
        let d: String
        let paint: String
    }

    private struct BackendSpriteDTO: Decodable {
        let name: String
        let paths: [BackendSpritePathDTO]?
        let motion: String?
        let size: String?
        let spin: Bool?
        let color: String?
    }

    private struct BackendAnnotationsDTO: Decodable {
        let status: String?
        let song_lang: String?
        let font: String?
        let motion: String?
        let intro: String?
        let outro: BackendAnnotationCommentDTO?
        let moments: [BackendAnnotationMomentDTO]?
        let spotlights: [BackendAnnotationSpotlightDTO]?
        let accent: String?
        let lines: [BackendAnnotationLineDTO]?
        let sprites: [BackendSpriteDTO]?
        let singers: [BackendSingerItemDTO]?
        let source: String?
    }

    private struct BackendTranslationLineDTO: Decodable {
        let text: String
        let occurrence: Int
        let bg: Bool?
        let translation: String
    }

    private struct BackendTranslationsDTO: Decodable {
        let status: String?
        let source: String?
        let target_lang: String?
        let native: Bool?
        let same_language: Bool?
        let lines: [BackendTranslationLineDTO]?
    }

    private struct BackendTranslationLangStatusDTO: Decodable {
        let lang: String
        let has_ai: Bool?
        let has_native: Bool?
        let generating: Bool?
        let same_language: Bool?
    }

    private struct BackendTranslationLanguagesDTO: Decodable {
        let status: String?
        let orig_lang: String?
        let song_lang: String?
        let languages: [BackendTranslationLangStatusDTO]?
    }

    private struct BackendPronunciationLineDTO: Decodable {
        let text: String
        let occurrence: Int
        let bg: Bool?
        let lang: String?
        let pronunciation: String
        let tokens: [String]?
    }

    private struct BackendPronunciationsDTO: Decodable {
        let status: String?
        let source: String?
        let lang: String?
        let lines: [BackendPronunciationLineDTO]?
    }

    private struct BackendSingerItemDTO: Decodable {
        let id: String
        let name: String?
        let role: String?
        let color: String?
        let align: String?
        let members: [String]?
    }

    private struct BackendSingerLineDTO: Decodable {
        let text: String
        let occurrence: Int
        let bg: Bool?
        let agent: String
    }

    private struct BackendSingersDTO: Decodable {
        let status: String?
        let source: String?
        let singers: [BackendSingerItemDTO]?
        let translated_names: [String: String]?
        let lines: [BackendSingerLineDTO]?
    }

    private struct BackendRhythmBeatDTO: Decodable {
        let t: Double
        let loud: Double
        let strength: Double
    }

    private struct BackendRhythmAnalysisDTO: Decodable {
        let duration_ms: Double
        let period_ms: Double
        let base_period_ms: Double
        let confidence: Double
        let loud_low: Double
        let loud_high: Double
        let beats: [BackendRhythmBeatDTO]?
    }

    private struct BackendSongRhythmDTO: Decodable {
        let status: String?
        let analysis: BackendRhythmAnalysisDTO?
    }

    /// 1:1 对齐 web/src/lib/lyrics/colors.ts 中的 MOOD_GLOW 柔和色温表
    private static let moodHexMap: [String: String] = [
        "calm": "#cfe8ff",
        "bright": "#ffe6a8",
        "sad": "#d6ceff",
        "intense": "#ffc0b3"
    ]

    enum PlaylistSyncOutcome: Sendable, Equatable {
        case notModified
        case updated(tracks: [PlaylistTrackItem], version: String?)
        case failed(String)
    }

    // MARK: - 公开歌单与单曲全量捆绑拉取

    /// 规范化用户输入的博客地址（支持裸域名/IP 自动补协议、自动剥离多余路径与查询串）
    static func normalizeBlogOrigin(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.lowercased().hasPrefix("peer://") else { return nil }

        let withScheme: String
        if trimmed.lowercased().hasPrefix("http://") || trimmed.lowercased().hasPrefix("https://") {
            withScheme = trimmed
        } else {
            let lower = trimmed.lowercased()
            let defaultHTTP = lower.hasPrefix("localhost")
                || lower.hasPrefix("127.0.0.1")
                || lower.hasPrefix("[::1]")
            withScheme = (defaultHTTP ? "http://" : "https://") + trimmed
        }

        guard let comps = URLComponents(string: withScheme),
              let scheme = comps.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              let host = comps.host,
              !host.isEmpty else {
            return nil
        }

        var normalized = URLComponents()
        normalized.scheme = scheme
        normalized.host = host
        normalized.port = comps.port
        return normalized.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// 结合后端 `/api/v1/music/playlist/version` 指纹与 `X-Playlist-Version` 响应头增量同步歌单
    static func syncPlaylist(
        origin: String,
        cachedVersion: String?,
        force: Bool = false
    ) async -> PlaylistSyncOutcome {
        guard let base = normalizeBlogOrigin(origin) else {
            return .failed("博客站点地址格式无效")
        }

        if !force,
           let cachedVer = cachedVersion?.trimmingCharacters(in: .whitespacesAndNewlines),
           !cachedVer.isEmpty,
           let verURL = URL(string: "\(base)/api/v1/music/playlist/version"),
           let remoteVer: String = await getData(url: verURL, timeout: 4.5, reload: true) {
            let trimmedRemote = remoteVer.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedRemote.isEmpty && trimmedRemote == cachedVer {
                return .notModified
            }
        }

        guard let playlistURL = URL(string: "\(base)/api/v1/music/playlist") else {
            return .failed("无法构造歌单请求地址")
        }
        var req = URLRequest(url: playlistURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15.0)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                return .failed("歌单接口响应无效")
            }
            guard (200..<300).contains(http.statusCode) else {
                return .failed("博客返回 HTTP \(http.statusCode)")
            }
            guard let env = try? JSONDecoder().decode(APIEnvelope<[BackendTrackDTO]>.self, from: data),
                  let list = env.data else {
                return .failed("解析歌单数据失败")
            }
            let versionHeader = http.value(forHTTPHeaderField: "X-Playlist-Version")?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let tracks = mapBackendTracks(list, baseOrigin: base)
            return .updated(tracks: tracks, version: (versionHeader?.isEmpty == false) ? versionHeader : nil)
        } catch {
            return .failed("无法连接博客：\(error.localizedDescription)")
        }
    }

    static func fetchPlaylist(origin: String) async -> [PlaylistTrackItem]? {
        switch await syncPlaylist(origin: origin, cachedVersion: nil, force: true) {
        case .updated(let tracks, _):
            return tracks
        case .notModified, .failed:
            return nil
        }
    }

    private static func mapBackendTracks(_ list: [BackendTrackDTO], baseOrigin: String) -> [PlaylistTrackItem] {
        list.enumerated().map { idx, item in
            let artists = (item.artists ?? []).joined(separator: " / ")
            let aliases = (item.aliases ?? []).filter { !$0.isEmpty && $0.caseInsensitiveCompare(item.name) != .orderedSame }
            let extra = aliases.isEmpty ? nil : aliases.joined(separator: " / ")
            return PlaylistTrackItem(
                index: idx,
                id: item.id,
                name: item.name,
                aliases: item.aliases ?? [],
                titleExtra: extra,
                artists: artists,
                album: item.album ?? "",
                albumPic: resolveCoverURL(raw: item.album_pic, origin: baseOrigin),
                durationMs: item.duration ?? 0
            )
        }
    }

    static func makeIslandTrack(from item: PlaylistTrackItem) -> IslandTrack {
        let artistList = item.artists
            .components(separatedBy: " / ")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return IslandTrack(
            id: item.id,
            name: item.name,
            titleExtra: item.titleExtra,
            artists: artistList,
            displayArtists: artistList,
            album: item.album,
            albumPic: item.albumPic,
            durationMs: item.durationMs
        )
    }

    /// 1:1 对齐 web/src/lib/lyrics/lyric-language.ts toggleLyricTranslationSelection
    static func toggleTranslationSelection(
        current: [TranslationSelectionItem],
        lang: String,
        preferNative: Bool,
        hasDualSources: Bool
    ) -> [TranslationSelectionItem] {
        if hasDualSources {
            if let idx = current.firstIndex(where: { $0.lang == lang && $0.preferNative == preferNative }) {
                var next = current
                next.remove(at: idx)
                return next
            }
            let nextItem = TranslationSelectionItem(lang: lang, preferNative: preferNative)
            if current.count >= 2 {
                return [current[current.count - 1], nextItem]
            }
            return current + [nextItem]
        }
        if current.contains(where: { $0.lang == lang }) {
            return current.filter { $0.lang != lang }
        }
        let nextItem = TranslationSelectionItem(lang: lang, preferNative: false)
        if current.count >= 2 {
            return [current[current.count - 1], nextItem]
        }
        return current + [nextItem]
    }

    static func resolveTrackBundle(
        origin: String,
        track: IslandTrack,
        preferences: IslandLyricPreferences,
        refresh: Bool = false,
        passivePreload: Bool = false
    ) async -> ResolvedBundle {
        let base = cleanOrigin(origin)
        let id = track.id
        let effectiveSelections = preferences.translationSelections.isEmpty
            ? [TranslationSelectionItem(lang: "zh", preferNative: false)]
            : Array(preferences.translationSelections.prefix(2))
        let primarySlot = effectiveSelections[0]
        let secondarySlot = effectiveSelections.count > 1 ? effectiveSelections[1] : nil
        let refreshQuery = refresh ? "?refresh=1" : ""

        async let settingsFetch: BackendLyricSettingsDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/settings"), reload: refresh)
        async let chorusFetch: [BackendChorusDTO]? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/chorus"), reload: refresh)
        async let annotationsFetch: BackendAnnotationsDTO? = passivePreload
            ? nil
            : await getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/annotations"), reload: refresh)
        async let rhythmFetch: BackendSongRhythmDTO? = passivePreload
            ? nil
            : await getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/rhythm"), reload: refresh)

        let cache: BackendLyricCacheDTO?
        var ncmFallback: BackendNCMLyricDTO?
        if refresh {
            // 手动重新获取歌词时跳过缓存，并发向后端请求各源刷新（与 web/src/api/music.ts refresh=1 行为对齐）
            async let freshTTML: BackendTTMLDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/ttml\(refreshQuery)"), reload: true)
            async let freshQQ: BackendQQLyricDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/qq\(refreshQuery)"), reload: true)
            async let freshKG: BackendQQLyricDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/kugou\(refreshQuery)"), reload: true)
            async let freshNCM: BackendNCMLyricDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric\(refreshQuery)"), reload: true)
            let (t, q, k, n) = await (freshTTML, freshQQ, freshKG, freshNCM)
            cache = BackendLyricCacheDTO(kind: nil, ncm: n, ttml: t, qq: q, kugou: k)
            ncmFallback = n
        } else {
            let fetchedCache: BackendLyricCacheDTO? = await getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/cache"))
            if let fetchedCache {
                cache = fetchedCache
                ncmFallback = fetchedCache.ncm
                if ncmFallback == nil {
                    ncmFallback = await getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric"))
                }
            } else {
                // 冷缓存曲目（尚未建立或超过 30 天缓存期）：并发探测 TTML / QQ / 酷狗 / 网易云全部词源，避免退化丢失逐字歌词
                async let coldTTML: BackendTTMLDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/ttml"))
                async let coldQQ: BackendQQLyricDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/qq"))
                async let coldKG: BackendQQLyricDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/kugou"))
                async let coldNCM: BackendNCMLyricDTO? = getData(url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric"))
                let (t, q, k, n) = await (coldTTML, coldQQ, coldKG, coldNCM)
                cache = BackendLyricCacheDTO(kind: nil, ncm: n, ttml: t, qq: q, kugou: k)
                ncmFallback = n
            }
        }

        let settings = await settingsFetch
        let annotations = await annotationsFetch
        let rawChorus = await chorusFetch ?? []
        let rawRhythm = await rhythmFetch

        let parsed = buildBaseLyrics(cache: cache, ncmFallback: ncmFallback, settings: settings)
        let hasVocalLines = !parsed.lines.isEmpty && !parsed.instrumental
        let sourceParam = parsed.source.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? parsed.source

        let needPrimaryAI = !passivePreload
            && hasVocalLines
            && preferences.showTranslation
            && !(primarySlot.preferNative && hasNativeTranslation(in: parsed.lines, for: primarySlot.lang))
        let needSecondaryAI: Bool = {
            guard !passivePreload, hasVocalLines, preferences.showTranslation, let sec = secondarySlot else {
                return false
            }
            if sec.preferNative && hasNativeTranslation(in: parsed.lines, for: sec.lang) {
                return false
            }
            if sec.lang == primarySlot.lang && needPrimaryAI {
                return false
            }
            return true
        }()
        let needPronunciations = !passivePreload && hasVocalLines && preferences.showRomaji
        let needSingers = !passivePreload && hasVocalLines
        let needLangs = !passivePreload && hasVocalLines

        async let primaryTransFetch: BackendTranslationsDTO? = needPrimaryAI
            ? await getData(
                url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/translations?lang=\(primarySlot.lang)&source=\(sourceParam)"),
                reload: refresh
            )
            : nil
        async let secondaryTransFetch: BackendTranslationsDTO? = {
            guard needSecondaryAI, let sec = secondarySlot else { return nil }
            return await getData(
                url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/translations?lang=\(sec.lang)&source=\(sourceParam)"),
                reload: refresh
            )
        }()
        async let pronunciationsFetch: BackendPronunciationsDTO? = needPronunciations
            ? await getData(
                url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/pronunciations?source=\(sourceParam)"),
                reload: refresh
            )
            : nil
        async let singersFetch: BackendSingersDTO? = needSingers
            ? await getData(
                url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/singers?lang=\(primarySlot.lang)&source=\(sourceParam)"),
                reload: refresh
            )
            : nil
        async let langsFetch: BackendTranslationLanguagesDTO? = needLangs
            ? await getData(
                url: URL(string: "\(base)/api/v1/music/song/\(id)/lyric/translations/available?source=\(sourceParam)"),
                reload: refresh
            )
            : nil

        let primaryTrans = await primaryTransFetch
        let secondaryTransRaw = await secondaryTransFetch
        let secondaryTrans = (secondarySlot?.lang == primarySlot.lang && needPrimaryAI) ? primaryTrans : secondaryTransRaw
        let pronunciations = await pronunciationsFetch
        let singers = await singersFetch
        let langsResp = await langsFetch

        let enriched = applyOverlays(
            base: parsed,
            annotations: annotations,
            primarySlot: primarySlot,
            primaryTranslations: primaryTrans,
            secondarySlot: secondarySlot,
            secondaryTranslations: secondaryTrans,
            pronunciations: pronunciations,
            singers: singers
        )
        let chorusRanges = rawChorus.compactMap { c -> TimeIntervalRange? in
            guard c.end > c.start else { return nil }
            return TimeIntervalRange(start: c.start, end: c.end)
        }
        let rhythmPayload = rawRhythm?.analysis.flatMap { buildRhythmPayload(from: $0) }
        let accent = (annotations?.accent?.hasPrefix("#") == true) ? annotations?.accent : nil
        let availableLangs: [AvailableTranslationLangItem]? = langsResp?.languages?
            .filter {
                !($0.same_language ?? false)
                    && (($0.has_ai ?? false) || ($0.has_native ?? false) || ($0.generating ?? false))
            }
            .map { item in
                let existingLabel = preferences.availableTranslationLangs.first(where: { $0.lang == item.lang })?.label
                let label = existingLabel ?? formatChineseLanguageLabel(item.lang) ?? item.lang
                return AvailableTranslationLangItem(
                    lang: item.lang,
                    label: label,
                    hasAi: item.has_ai ?? false,
                    hasNative: item.has_native ?? false,
                    generating: item.generating ?? false
                )
            }
        let resolvedSongLangCode = resolveBestSongLangCode(
            langsResp: langsResp,
            annotations: annotations,
            pronunciations: pronunciations,
            lyrics: enriched
        )
        let songLangLabel = formatChineseLanguageLabel(resolvedSongLangCode)
        let transPending = (primaryTrans?.status == "pending")
            || (secondaryTrans?.status == "pending")
            || (availableLangs?.contains(where: { $0.generating && ($0.lang == primarySlot.lang || $0.lang == secondarySlot?.lang) }) == true)
        let romaPending = pronunciations?.status == "pending"

        return ResolvedBundle(
            track: track,
            accentHex: accent,
            chorus: chorusRanges,
            lyrics: enriched,
            rhythmData: rhythmPayload,
            songLangLabel: songLangLabel,
            availableTranslationLangs: availableLangs,
            translationsGenerating: transPending,
            pronunciationsGenerating: romaPending
        )
    }

    private static let chineseLanguageNames: [String: String] = [
        "zh-cn": "简体中文",
        "zh-tw": "繁体中文",
        "zh-hk": "中文（香港）",
        "yue": "粤语",
        "nan": "闽南语",
        "wuu": "吴语",
        "hak": "客家话",
        "lzh": "文言文",
        "en": "英语",
        "ja": "日语",
        "ko": "韩语",
        "fr": "法语",
        "de": "德语",
        "es": "西班牙语",
        "pt": "葡萄牙语",
        "it": "意大利语",
        "ru": "俄语",
        "la": "拉丁语",
        "th": "泰语",
        "vi": "越南语",
        "id": "印尼语",
        "ms": "马来语",
        "tl": "菲律宾语",
        "hi": "印地语",
        "sa": "梵语",
        "ar": "阿拉伯语",
        "fa": "波斯语",
        "he": "希伯来语",
        "tr": "土耳其语",
        "el": "希腊语",
        "nl": "荷兰语",
        "pl": "波兰语",
        "uk": "乌克兰语",
        "cs": "捷克语",
        "hu": "匈牙利语",
        "ro": "罗马尼亚语",
        "sv": "瑞典语",
        "no": "挪威语",
        "da": "丹麦语",
        "fi": "芬兰语",
        "is": "冰岛语",
        "ga": "爱尔兰语",
        "cy": "威尔士语",
        "ca": "加泰罗尼亚语",
        "eo": "世界语",
        "mn": "蒙古语",
        "bo": "藏语",
        "ug": "维吾尔语",
        "art": "架空语",
        "mul": "多语种"
    ]

    static func normalizeDisplayLangCode(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let tag = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "_", with: "-")
        if tag.isEmpty || tag.contains("-latn") { return nil }
        if ["other", "und", "zxx", "unknown", "none"].contains(tag) { return nil }
        if ["mul", "multilingual", "mixed"].contains(tag) { return "mul" }
        if ["art", "qya", "sjn", "tlh", "conlang", "x-conlang"].contains(tag) { return "art" }
        if tag == "yue" || tag == "zh-yue" || tag.hasPrefix("yue-") || tag.hasPrefix("zh-yue-") { return "yue" }
        if tag == "nan" || tag == "zh-nan" || tag == "zh-min" || tag == "zh-min-nan" || tag.hasPrefix("nan-") || tag.hasPrefix("zh-nan-") || tag.hasPrefix("zh-min-") || tag == "hokkien" || tag == "taiwanese" { return "nan" }
        if tag == "wuu" || tag == "zh-wuu" || tag.hasPrefix("wuu-") || tag.hasPrefix("zh-wuu-") { return "wuu" }
        if tag == "hak" || tag == "zh-hak" || tag == "zh-hakka" || tag.hasPrefix("hak-") || tag.hasPrefix("zh-hak-") { return "hak" }
        if tag == "lzh" || tag == "zh-lzh" || tag == "zh-classical" || tag.hasPrefix("lzh-") || tag.hasPrefix("zh-lzh-") { return "lzh" }
        if tag == "zh-hk" || tag == "zh-mo" || tag.hasPrefix("zh-hk-") || tag.hasPrefix("zh-mo-") || tag == "zh-hant-hk" || tag == "zh-hant-mo" || (tag.hasPrefix("zh-") && (tag.hasSuffix("-hk") || tag.hasSuffix("-mo"))) { return "zh-hk" }
        if tag == "zh-tw" || tag.hasPrefix("zh-tw-") || tag == "zh-hant" || tag.hasPrefix("zh-hant-") || tag == "cmn-hant" || (tag.hasPrefix("zh-") && (tag.contains("-hant") || tag.hasSuffix("-tw"))) { return "zh-tw" }
        if tag == "zh" || tag == "zh-cn" || tag == "zh-sg" || tag == "zh-my" || tag.hasPrefix("zh-cn-") || tag == "zh-hans" || tag.hasPrefix("zh-hans-") || tag == "cmn" || tag == "cmn-hans" || tag.hasPrefix("zh-") { return "zh-cn" }

        let head = String(tag.split(separator: "-", maxSplits: 1).first ?? "")
        switch head {
        case "jp": return "ja"
        case "kr": return "ko"
        case "iw": return "he"
        case "in": return "id"
        case "ji": return "yi"
        case "fil": return "tl"
        case "nb", "nn": return "no"
        default:
            return (2...3).contains(head.count) && head.allSatisfy({ $0.isASCII && $0.isLetter }) ? head : nil
        }
    }

    static func formatChineseLanguageLabel(_ raw: String?) -> String? {
        guard let code = normalizeDisplayLangCode(raw) else { return nil }
        if let mapped = chineseLanguageNames[code] {
            return mapped
        }
        guard let localized = Locale(identifier: "zh-Hans").localizedString(forLanguageCode: code),
              localized.lowercased() != code.lowercased() else {
            return nil
        }
        return localized
    }

    static func detectLocalLyricsSongLangCode(_ lyrics: LyricsBundlePayload) -> String? {
        guard !lyrics.instrumental && !lyrics.lines.isEmpty else { return nil }
        let plainTexts = lyrics.lines.map(\.plainText).filter { !$0.isEmpty }
        guard !plainTexts.isEmpty else { return nil }
        let nativeRomaji = lyrics.lines.compactMap { $0.romanization?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let pronLang = RomanizationAligner.detectSongPronunciationLang(
            texts: plainTexts,
            nativeRomanizations: nativeRomaji,
            aiSongLang: nil
        )
        switch pronLang {
        case "zh": return "zh-cn"
        case "zh-tw": return "zh-tw"
        case "zh-hk": return "yue"
        case "ja", "ko", "en": return pronLang
        default: return nil
        }
    }

    static func detectLocalLyricsSongLangLabel(_ lyrics: LyricsBundlePayload) -> String? {
        formatChineseLanguageLabel(detectLocalLyricsSongLangCode(lyrics))
    }

    private static func resolveBestSongLangCode(
        langsResp: BackendTranslationLanguagesDTO?,
        annotations: BackendAnnotationsDTO?,
        pronunciations: BackendPronunciationsDTO?,
        lyrics: LyricsBundlePayload
    ) -> String? {
        func rank(_ code: String?) -> Int {
            guard let code, !code.isEmpty else { return 0 }
            if ["zh-cn", "en", "ja", "ko"].contains(code) { return 1 }
            if ["zh-tw", "zh-hk"].contains(code) { return 2 }
            return 3
        }
        let c1 = normalizeDisplayLangCode(langsResp?.song_lang)
        let c2 = normalizeDisplayLangCode(annotations?.song_lang)
        let rawPron = pronunciations?.lang?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let c3: String? = (rawPron == "zh-hk") ? "yue" : normalizeDisplayLangCode(rawPron)
        let c4 = normalizeDisplayLangCode(langsResp?.orig_lang)
        let c5 = detectLocalLyricsSongLangCode(lyrics)

        var best: String?
        var bestRank = 0
        for candidate in [c1, c2, c3, c4, c5] {
            let r = rank(candidate)
            if r > bestRank {
                best = candidate
                bestRank = r
            }
        }
        return best
    }

    static func parseTTMLForTesting(
        xml: String,
        annotationsJSON: Data? = nil,
        primarySlot: TranslationSelectionItem = TranslationSelectionItem(lang: "zh", preferNative: false),
        primaryTranslationsJSON: Data? = nil,
        secondarySlot: TranslationSelectionItem? = nil,
        secondaryTranslationsJSON: Data? = nil,
        pronunciationsJSON: Data? = nil
    ) -> LyricsBundlePayload {
        let base = enrichNativeRomanizationWords(parseTTML(xml: xml, source: "ttml-amll", sourceName: nil))
        let annotations = annotationsJSON.flatMap { try? JSONDecoder().decode(BackendAnnotationsDTO.self, from: $0) }
        let primaryTrans = primaryTranslationsJSON.flatMap { try? JSONDecoder().decode(BackendTranslationsDTO.self, from: $0) }
        let secondaryTrans = secondaryTranslationsJSON.flatMap { try? JSONDecoder().decode(BackendTranslationsDTO.self, from: $0) }
        let pronunciations = pronunciationsJSON.flatMap { try? JSONDecoder().decode(BackendPronunciationsDTO.self, from: $0) }
        return applyOverlays(
            base: base,
            annotations: annotations,
            primarySlot: primarySlot,
            primaryTranslations: primaryTrans,
            secondarySlot: secondarySlot,
            secondaryTranslations: secondaryTrans,
            pronunciations: pronunciations,
            singers: nil
        )
    }

    static func buildBaseLyricsForTesting(
        cacheJSON: Data?,
        ncmJSON: Data? = nil,
        pin: String? = nil,
        offsets: [String: Double]? = nil,
        pronunciationsJSON: Data? = nil
    ) -> LyricsBundlePayload {
        let cache = cacheJSON.flatMap { try? JSONDecoder().decode(BackendLyricCacheDTO.self, from: $0) }
        let ncm = ncmJSON.flatMap { try? JSONDecoder().decode(BackendNCMLyricDTO.self, from: $0) } ?? cache?.ncm
        let settings = (pin != nil || offsets != nil) ? BackendLyricSettingsDTO(offsets: offsets, pin: pin) : nil
        let base = buildBaseLyrics(cache: cache, ncmFallback: ncm, settings: settings)
        let pronunciations = pronunciationsJSON.flatMap { try? JSONDecoder().decode(BackendPronunciationsDTO.self, from: $0) }
        return applyOverlays(
            base: base,
            annotations: nil,
            primarySlot: TranslationSelectionItem(lang: "zh", preferNative: false),
            primaryTranslations: nil,
            secondarySlot: nil,
            secondaryTranslations: nil,
            pronunciations: pronunciations,
            singers: nil
        )
    }

    static func resolveCoverURLForTesting(raw: String?, origin: String) -> String? {
        resolveCoverURL(raw: raw, origin: cleanOrigin(origin))
    }

    // MARK: - 基础歌词源选择与解析（TTML / YRC / QRC / LRC）

    private struct MutableLine {
        var start: Double
        var end: Double
        var isDuet: Bool = false
        var isBackground: Bool = false
        var align: String = "left"
        var owner: Int = -1
        var paragraphStart: Bool = false
        var backgroundPosition: String? = nil
        var chorusStart: Bool = false
        var agentId: String? = nil
        var edgeColors: [String]? = nil
        var singerName: String? = nil
        var singerDotOnly: Bool = false
        var translation: String? = nil
        var translationsByLang: [String: String] = [:]
        var secondaryTranslation: String? = nil
        var romanization: String? = nil
        var romanizationWords: [LyricRomanWordPayload] = []
        var moodHex: String? = nil
        var scene: String? = nil
        var sceneColorHex: String? = nil
        var sceneLines: Int? = nil
        var words: [LyricWordPayload]
        var emphasis: [LyricEmphasisPayload] = []

        var plainText: String {
            words.map(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private struct BaseParsedLyrics {
        var source: String
        var sourceName: String?
        var wordSynced: Bool
        var instrumental: Bool
        var lines: [MutableLine]
        var ttmlAgents: [String: (name: String?, isGroup: Bool, members: [String])] = [:]
    }

    private static func buildBaseLyrics(
        cache: BackendLyricCacheDTO?,
        ncmFallback: BackendNCMLyricDTO?,
        settings: BackendLyricSettingsDTO?
    ) -> BaseParsedLyrics {
        let preferred = settings?.pin?.isEmpty == false ? settings!.pin! : (cache?.kind ?? "")
        var candidateOrder: [String] = []
        for k in [preferred, "ttml", "qq", "kugou", "ncm"] where !k.isEmpty && !candidateOrder.contains(k) {
            candidateOrder.append(k)
        }

        for kind in candidateOrder {
            switch kind {
            case "ttml":
                if let ttml = cache?.ttml, let xml = ttml.ttml, !xml.isEmpty {
                    let src = ttml.source == "custom" ? "ttml-custom" : "ttml-amll"
                    let parsed = parseTTML(xml: xml, source: src, sourceName: ttml.name)
                    if !parsed.lines.isEmpty {
                        return applyOffset(enrichNativeRomanizationWords(parsed), offsets: settings?.offsets)
                    }
                }
            case "qq":
                if let qq = cache?.qq {
                    if let xml = qq.ttml, !xml.isEmpty {
                        let parsed = parseTTML(xml: xml, source: "ttml-amll", sourceName: nil)
                        if !parsed.lines.isEmpty {
                            return applyOffset(enrichNativeRomanizationWords(parsed), offsets: settings?.offsets)
                        }
                    }
                    if let text = qq.lyric, !text.isEmpty {
                        let isQrc = qq.format == "qrc"
                        let src = isQrc ? "qq-qrc" : "qq-lrc"
                        let parsed = parseQRCOrLRC(
                            lyric: text,
                            isWordTimed: isQrc,
                            translation: qq.translation,
                            romanization: qq.romanization,
                            source: src
                        )
                        if !parsed.lines.isEmpty {
                            return applyOffset(enrichNativeRomanizationWords(parsed), offsets: settings?.offsets)
                        }
                    }
                }
            case "kugou":
                if let kg = cache?.kugou, let text = kg.lyric, !text.isEmpty {
                    let isQrc = kg.format == "qrc"
                    let src = isQrc ? "kugou-krc" : "kugou-lrc"
                    let parsed = parseQRCOrLRC(
                        lyric: text,
                        isWordTimed: isQrc,
                        translation: kg.translation,
                        romanization: kg.romanization,
                        source: src
                    )
                    if !parsed.lines.isEmpty {
                        return applyOffset(enrichNativeRomanizationWords(parsed), offsets: settings?.offsets)
                    }
                }
            case "ncm":
                if let ncm = ncmFallback {
                    if let yrc = ncm.yrc?.lyric, !yrc.isEmpty {
                        let parsed = parseYRC(
                            yrc: yrc,
                            tlyric: ncm.ytlrc?.lyric ?? ncm.tlyric?.lyric,
                            romalrc: ncm.yromalrc?.lyric ?? ncm.romalrc?.lyric
                        )
                        if !parsed.lines.isEmpty {
                            return applyOffset(enrichNativeRomanizationWords(parsed), offsets: settings?.offsets)
                        }
                    }
                    if let lrc = ncm.lrc?.lyric, !lrc.isEmpty {
                        if lrc.contains("纯音乐，请欣赏") || lrc.contains("純音樂，請欣賞") {
                            return BaseParsedLyrics(source: "ncm-lrc", sourceName: nil, wordSynced: false, instrumental: true, lines: [])
                        }
                        let parsed = parseQRCOrLRC(
                            lyric: lrc,
                            isWordTimed: false,
                            translation: ncm.tlyric?.lyric,
                            romanization: ncm.romalrc?.lyric,
                            source: "ncm-lrc"
                        )
                        if !parsed.lines.isEmpty {
                            return applyOffset(enrichNativeRomanizationWords(parsed), offsets: settings?.offsets)
                        }
                    }
                }
            default:
                break
            }
        }

        return BaseParsedLyrics(source: "none", sourceName: nil, wordSynced: false, instrumental: false, lines: [])
    }

    /// 对齐 web/src/contexts/song-lyrics.ts `withRomanizationWords`：对逐字歌词中尚无分段时间戳音译的行做假名锚点/汉字单字对齐
    private static func enrichNativeRomanizationWords(_ input: BaseParsedLyrics) -> BaseParsedLyrics {
        guard input.wordSynced else { return input }
        var out = input
        for i in out.lines.indices where out.lines[i].romanizationWords.isEmpty {
            guard let roma = out.lines[i].romanization,
                  !roma.isEmpty,
                  let aligned = RomanizationAligner.alignRomanization(roma, words: out.lines[i].words) else {
                continue
            }
            out.lines[i].romanizationWords = RomanizationAligner.sanitizeForPayload(aligned)
        }
        return out
    }

    private static func applyOffset(_ input: BaseParsedLyrics, offsets: [String: Double]?) -> BaseParsedLyrics {
        guard let delta = offsets?[input.source], abs(delta) >= 1 else { return input }
        var out = input
        out.lines = input.lines.map { line in
            var copy = line
            copy.start = max(0, line.start + delta)
            copy.end = max(copy.start, line.end + delta)
            copy.words = line.words.map { w in
                let ws = max(0, w.start + delta)
                let we = max(ws, w.end + delta)
                let rubies = w.ruby?.map { r in
                    let rs = max(0, r.start + delta)
                    return LyricRubyPayload(text: r.text, start: rs, end: max(rs, r.end + delta))
                }
                return LyricWordPayload(text: w.text, start: ws, end: we, ruby: rubies)
            }
            copy.romanizationWords = line.romanizationWords.map { rw in
                let rs = max(0, rw.start + delta)
                return LyricRomanWordPayload(text: rw.text, start: rs, end: max(rs, rw.end + delta), word: rw.word)
            }
            return copy
        }
        return out
    }

    // MARK: - YRC / QRC / LRC 解析

    private enum ExtraLyricParseMode {
        case ncm
        case qrcOrLrc
    }

    private struct ExtraLyricEntry {
        let timeMs: Double
        let text: String
        let items: [RomanizationAligner.TimedSpan]?
    }

    private static func stripBracketMarks(_ s: String) -> String {
        s.replacingOccurrences(of: "〖", with: "").replacingOccurrences(of: "〗", with: "")
    }

    /// 1:1 对齐 parse-platform.ts：同时支持 `[start,dur]`（YRC / QRC）与 `[mm:ss.xx]`（LRC）附加翻译/音译轨，并保留 QRC 逐音节时间片
    private static func parseExtraEntries(
        _ raw: String?,
        mode: ExtraLyricParseMode,
        keepTimedItems: Bool
    ) -> [ExtraLyricEntry] {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return []
        }
        let hasMillisecondBracketLine = trimmed.range(of: #"(?m)^\[\d+,\d+\]"#, options: .regularExpression) != nil
        if hasMillisecondBracketLine {
            let headerRegex = try? NSRegularExpression(pattern: #"^\[(\d+),(\d+)\](.*)$"#)
            var out: [ExtraLyricEntry] = []
            if mode == .ncm {
                let wordRegex = try? NSRegularExpression(pattern: #"\((\d+),(\d+),\d+\)([\s\S]*?)(?=\(\d+,\d+,\d+\)|$)"#)
                for line in trimmed.components(separatedBy: .newlines) {
                    let t = line.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !t.hasPrefix("{"),
                          let hMatch = headerRegex?.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)),
                          let sRange = Range(hMatch.range(at: 1), in: t),
                          let bodyRange = Range(hMatch.range(at: 3), in: t),
                          let lineStart = Double(t[sRange]) else { continue }
                    let body = String(t[bodyRange])
                    let matches = wordRegex?.matches(in: body, range: NSRange(body.startIndex..., in: body)) ?? []
                    var joined = ""
                    for m in matches {
                        if let txR = Range(m.range(at: 3), in: body) {
                            joined += stripBracketMarks(String(body[txR]))
                        }
                    }
                    let clean = joined.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !clean.isEmpty {
                        out.append(ExtraLyricEntry(timeMs: lineStart, text: clean, items: nil))
                    }
                }
            } else {
                let qrcWordRegex = try? NSRegularExpression(pattern: #"([\s\S]*?)\((\d+),(\d+)\)"#)
                for line in trimmed.components(separatedBy: .newlines) {
                    let t = line.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let hMatch = headerRegex?.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)),
                          let sRange = Range(hMatch.range(at: 1), in: t),
                          let bodyRange = Range(hMatch.range(at: 3), in: t),
                          let lineStart = Double(t[sRange]) else { continue }
                    let body = String(t[bodyRange])
                    let matches = qrcWordRegex?.matches(in: body, range: NSRange(body.startIndex..., in: body)) ?? []
                    var items: [RomanizationAligner.TimedSpan] = []
                    var joined = ""
                    for m in matches {
                        guard let txR = Range(m.range(at: 1), in: body),
                              let wsR = Range(m.range(at: 2), in: body),
                              let wdR = Range(m.range(at: 3), in: body),
                              let ws = Double(body[wsR]),
                              let wd = Double(body[wdR]) else { continue }
                        let rawPiece = stripBracketMarks(String(body[txR]))
                        if !rawPiece.isEmpty {
                            joined += rawPiece
                            items.append(RomanizationAligner.TimedSpan(text: rawPiece, start: ws, end: ws + max(0, wd)))
                        }
                    }
                    let clean = joined.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !clean.isEmpty else { continue }
                    let validTimed = keepTimedItems && items.contains(where: { $0.end > $0.start })
                    out.append(ExtraLyricEntry(timeMs: lineStart, text: clean, items: validTimed ? items : nil))
                }
            }
            return out.sorted { $0.timeMs < $1.timeMs }
        }

        return parseLRCEntries(trimmed).compactMap { entry in
            let clean = stripBracketMarks(entry.text).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clean.isEmpty else { return nil }
            return ExtraLyricEntry(timeMs: entry.timeMs, text: clean, items: nil)
        }
    }

    /// 1:1 对齐 parse-platform.ts `alignPlatformExtras`：1000ms 内按时间偏差最小优先一对一配对
    private static func alignExtraEntries(
        baseStarts: [Double],
        extras: [ExtraLyricEntry]
    ) -> [Int: ExtraLyricEntry] {
        guard !baseStarts.isEmpty, !extras.isEmpty else { return [:] }
        var pairs: [(offset: Double, base: Int, extra: Int)] = []
        for (eIdx, extraItem) in extras.enumerated() {
            for (bIdx, bStart) in baseStarts.enumerated() {
                let offset = abs(bStart - extraItem.timeMs)
                if offset <= 1000.0 {
                    pairs.append((offset, bIdx, eIdx))
                }
            }
        }
        pairs.sort {
            if $0.offset != $1.offset { return $0.offset < $1.offset }
            if $0.base != $1.base { return $0.base < $1.base }
            return $0.extra < $1.extra
        }
        var usedBase = Set<Int>()
        var usedExtra = Set<Int>()
        var result: [Int: ExtraLyricEntry] = [:]
        for p in pairs {
            if usedBase.contains(p.base) || usedExtra.contains(p.extra) {
                continue
            }
            usedBase.insert(p.base)
            usedExtra.insert(p.extra)
            result[p.base] = extras[p.extra]
        }
        return result
    }

    private static func parseYRC(yrc: String, tlyric: String?, romalrc: String?) -> BaseParsedLyrics {
        let transExtras = parseExtraEntries(tlyric, mode: .ncm, keepTimedItems: false).filter { $0.text != "//" }
        let romaExtras = parseExtraEntries(romalrc, mode: .ncm, keepTimedItems: false)
        var lines: [MutableLine] = []
        let headerRegex = try? NSRegularExpression(pattern: #"^\[(\d+),(\d+)\](.*)$"#)
        let wordRegex = try? NSRegularExpression(pattern: #"\((\d+),(\d+),\d+\)([\s\S]*?)(?=\(\d+,\d+,\d+\)|$)"#)

        for raw in yrc.components(separatedBy: .newlines) {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.hasPrefix("["), !trimmed.hasPrefix("[ch:") else { continue }
            guard let hMatch = headerRegex?.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
                  let sRange = Range(hMatch.range(at: 1), in: trimmed),
                  let dRange = Range(hMatch.range(at: 2), in: trimmed),
                  let bodyRange = Range(hMatch.range(at: 3), in: trimmed),
                  let lineStart = Double(trimmed[sRange]),
                  let lineDur = Double(trimmed[dRange]) else {
                continue
            }
            let body = String(trimmed[bodyRange])
            let matches = wordRegex?.matches(in: body, range: NSRange(body.startIndex..., in: body)) ?? []
            var words: [LyricWordPayload] = []
            for m in matches {
                guard let wsR = Range(m.range(at: 1), in: body),
                      let wdR = Range(m.range(at: 2), in: body),
                      let txR = Range(m.range(at: 3), in: body),
                      let ws = Double(body[wsR]),
                      let wd = Double(body[wdR]) else { continue }
                let text = String(body[txR])
                if !text.isEmpty {
                    words.append(LyricWordPayload(text: text, start: ws, end: ws + max(0, wd)))
                }
            }
            let plain = words.map(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines)
            if plain.isEmpty || isMetadataCreditLine(plain) { continue }
            let end = max(lineStart + lineDur, words.last?.end ?? lineStart)
            lines.append(
                MutableLine(
                    start: lineStart,
                    end: end,
                    words: words
                )
            )
        }

        let starts = lines.map(\.start)
        let alignedTrans = alignExtraEntries(baseStarts: starts, extras: transExtras)
        let alignedRoma = alignExtraEntries(baseStarts: starts, extras: romaExtras)
        for i in lines.indices {
            if let tr = alignedTrans[i]?.text, tr != lines[i].plainText {
                lines[i].translation = tr
            }
            if let rm = alignedRoma[i]?.text {
                lines[i].romanization = rm
            }
        }
        return BaseParsedLyrics(source: "ncm-yrc", sourceName: nil, wordSynced: true, instrumental: false, lines: lines)
    }

    private static func parseQRCOrLRC(
        lyric: String,
        isWordTimed: Bool,
        translation: String?,
        romanization: String?,
        source: String
    ) -> BaseParsedLyrics {
        let isNcm = source.hasPrefix("ncm")
        let transExtras = parseExtraEntries(translation, mode: isNcm ? .ncm : .qrcOrLrc, keepTimedItems: false)
            .filter { $0.text != "//" }
        let romaExtras = parseExtraEntries(romanization, mode: isNcm ? .ncm : .qrcOrLrc, keepTimedItems: !isNcm && isWordTimed)
            .filter { isNcm || !RomanizationAligner.containsCJK($0.text) }

        if isWordTimed {
            var lines: [MutableLine] = []
            let headerRegex = try? NSRegularExpression(pattern: #"^\[(\d+),(\d+)\](.*)$"#)
            let qrcWordRegex = try? NSRegularExpression(pattern: #"([\s\S]*?)\((\d+),(\d+)\)"#)
            for raw in lyric.components(separatedBy: .newlines) {
                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let hMatch = headerRegex?.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
                      let sRange = Range(hMatch.range(at: 1), in: trimmed),
                      let dRange = Range(hMatch.range(at: 2), in: trimmed),
                      let bodyRange = Range(hMatch.range(at: 3), in: trimmed),
                      let lineStart = Double(trimmed[sRange]),
                      let lineDur = Double(trimmed[dRange]) else { continue }
                let body = String(trimmed[bodyRange])
                let matches = qrcWordRegex?.matches(in: body, range: NSRange(body.startIndex..., in: body)) ?? []
                var words: [LyricWordPayload] = []
                for m in matches {
                    guard let txR = Range(m.range(at: 1), in: body),
                          let wsR = Range(m.range(at: 2), in: body),
                          let wdR = Range(m.range(at: 3), in: body),
                          let ws = Double(body[wsR]),
                          let wd = Double(body[wdR]) else { continue }
                    let text = String(body[txR])
                    if !text.isEmpty {
                        words.append(LyricWordPayload(text: text, start: ws, end: ws + max(0, wd)))
                    }
                }
                let plain = words.map(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines)
                if plain.isEmpty || isMetadataCreditLine(plain) { continue }
                lines.append(
                    MutableLine(
                        start: lineStart,
                        end: max(lineStart + lineDur, words.last?.end ?? lineStart),
                        words: words
                    )
                )
            }
            let starts = lines.map(\.start)
            let alignedTrans = alignExtraEntries(baseStarts: starts, extras: transExtras)
            let alignedRoma = alignExtraEntries(baseStarts: starts, extras: romaExtras)
            for i in lines.indices {
                if let tr = alignedTrans[i]?.text, tr != lines[i].plainText {
                    lines[i].translation = tr
                }
                if let rm = alignedRoma[i] {
                    lines[i].romanization = rm.text
                    if !isNcm, let items = rm.items,
                       let timedWords = RomanizationAligner.romanWordsFromTimed(items, words: lines[i].words) {
                        lines[i].romanizationWords = RomanizationAligner.sanitizeForPayload(timedWords)
                    }
                }
            }
            return BaseParsedLyrics(source: source, sourceName: nil, wordSynced: true, instrumental: false, lines: lines)
        }

        let rawItems = parseLRCEntries(lyric)
        var lines: [MutableLine] = []
        for (idx, item) in rawItems.enumerated() {
            if item.text.isEmpty || isMetadataCreditLine(item.text) { continue }
            let nextStart = idx + 1 < rawItems.count ? rawItems[idx + 1].timeMs : (item.timeMs + 4000)
            let end = max(item.timeMs + 600, min(nextStart, item.timeMs + 8000))
            lines.append(
                MutableLine(
                    start: item.timeMs,
                    end: end,
                    words: [LyricWordPayload(text: item.text, start: item.timeMs, end: end)]
                )
            )
        }
        let starts = lines.map(\.start)
        let alignedTrans = alignExtraEntries(baseStarts: starts, extras: transExtras)
        let alignedRoma = alignExtraEntries(baseStarts: starts, extras: romaExtras)
        for i in lines.indices {
            if let tr = alignedTrans[i]?.text, tr != lines[i].plainText {
                lines[i].translation = tr
            }
            if let rm = alignedRoma[i]?.text {
                lines[i].romanization = rm
            }
        }
        return BaseParsedLyrics(source: source, sourceName: nil, wordSynced: false, instrumental: false, lines: lines)
    }

    private static func parseLRCEntries(_ raw: String?) -> [(timeMs: Double, text: String)] {
        guard let raw, !raw.isEmpty else { return [] }
        guard let tagRegex = try? NSRegularExpression(pattern: #"\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]"#) else {
            return []
        }
        var out: [(Double, String)] = []
        for line in raw.components(separatedBy: .newlines) {
            let matches = tagRegex.matches(in: line, range: NSRange(line.startIndex..., in: line))
            guard !matches.isEmpty, let lastMatch = matches.last,
                  let textStart = Range(lastMatch.range, in: line)?.upperBound else { continue }
            let content = String(line[textStart...]).trimmingCharacters(in: .whitespacesAndNewlines)
            for m in matches {
                guard let minR = Range(m.range(at: 1), in: line),
                      let secR = Range(m.range(at: 2), in: line),
                      let mins = Double(line[minR]),
                      let secs = Double(line[secR]) else { continue }
                var msFrac = 0.0
                if m.range(at: 3).location != NSNotFound, let fR = Range(m.range(at: 3), in: line) {
                    let fStr = String(line[fR])
                    let val = Double(fStr) ?? 0
                    msFrac = fStr.count == 1 ? val * 100 : (fStr.count == 2 ? val * 10 : val)
                }
                out.append((mins * 60_000 + secs * 1000 + msFrac, content))
            }
        }
        out.sort { $0.0 < $1.0 }
        return out
    }

    private static func isMetadataCreditLine(_ text: String) -> Bool {
        let prefixes = ["作词", "作曲", "编曲", "制作人", "混音", "母带", "录音", "监制", "出品", "词：", "曲："]
        return prefixes.contains { text.hasPrefix($0) && (text.contains(":") || text.contains("：")) }
    }

    // MARK: - TTML XML 解析器（支持多歌手 agent、振假名 ruby 与 x-bg 背景和声）

    private static func parseTTML(xml: String, source: String, sourceName: String?) -> BaseParsedLyrics {
        guard let data = xml.data(using: .utf8) else {
            return BaseParsedLyrics(source: source, sourceName: sourceName, wordSynced: false, instrumental: false, lines: [])
        }
        let sax = TTMLSAXHandler()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = false
        parser.delegate = sax
        _ = parser.parse()

        let wordSynced = sax.lines.contains { $0.words.count > 1 || ($0.words.first.map { $0.end > $0.start } ?? false) }
        // 对齐 web/src/lib/lyrics/parse-ttml.ts L500-510：独唱曲目虽常声明单个 ttm:agent="v1"，不应启用多声部色条与胶囊
        var parsedLines = sax.lines
        var parsedAgents = sax.agents
        let usedAgents = Set(parsedLines.filter { !$0.isBackground }.compactMap(\.agentId))
        let usedSolos = usedAgents.filter { !(parsedAgents[$0]?.isGroup ?? ($0 == "v1000")) }
        let hasGroup = usedAgents.contains { parsedAgents[$0]?.isGroup ?? ($0 == "v1000") }
        let hasImplicitPrimary = parsedLines.contains { !$0.isBackground && $0.agentId == nil }
        let declaredSoloOrder = parsedAgents.keys.filter { !(parsedAgents[$0]?.isGroup ?? ($0 == "v1000")) }.sorted()
        let singleSoloIsSecondary = usedSolos.count == 1
            && ((declaredSoloOrder.firstIndex(of: usedSolos.first!) ?? 0) > 0)
        if usedSolos.count <= 1 && !hasGroup && !(hasImplicitPrimary && singleSoloIsSecondary) {
            for i in parsedLines.indices {
                parsedLines[i].agentId = nil
            }
            parsedAgents.removeAll()
        }

        return BaseParsedLyrics(
            source: source,
            sourceName: sourceName,
            wordSynced: wordSynced,
            instrumental: false,
            lines: parsedLines,
            ttmlAgents: parsedAgents
        )
    }

    private final class TTMLSAXHandler: NSObject, XMLParserDelegate {
        var agents: [String: (name: String?, isGroup: Bool, members: [String])] = [:]
        var lines: [MutableLine] = []

        private var currentAgentId: String?
        private var currentAgentType: String?
        private var capturingAgentName = false
        private var agentNameBuf = ""

        private var nextDivStartsParagraph = false
        private var inP = false
        private var pKey: String? = nil
        private var pStart: Double = 0
        private var pEnd: Double = 0
        private var pAgent: String?
        private var pParagraphStart = false

        private struct KeyedRomanEntry {
            let isLatnPreferred: Bool
            let mainText: String
            let mainSpans: [RomanizationAligner.TimedSpan]
            let bgText: String
            let bgSpans: [RomanizationAligner.TimedSpan]
        }

        private var transliterationsByKey: [String: KeyedRomanEntry] = [:]
        private var inTransliterationBlock = false
        private var translitBlockIsLatn = false
        private var currentTranslitKey: String? = nil
        private var translitFullBuf = ""
        private var translitMainBuf = ""
        private var translitMainSpans: [RomanizationAligner.TimedSpan] = []
        private var translitInBg = false
        private var translitBgStart: Double? = nil
        private var translitBgEnd: Double? = nil
        private var translitBgBuf = ""
        private var translitBgSpans: [RomanizationAligner.TimedSpan] = []
        private var translitActiveSpan: (start: Double?, end: Double?, forBg: Bool, buf: String)? = nil
        private var translitSpanDepth = 0

        private struct SpanEntry {
            let role: String
            let rubyRole: String
            let lang: String?
            let pushedWordFrame: Bool
            let pushedRubyContainer: Bool
            let pushedRubyPiece: Bool
            let isRubyBasePiece: Bool
            let pushedInlineRomaSpan: Bool
        }

        private struct TimedPiece {
            var text: String = ""
            let start: Double?
            let end: Double?
        }

        private struct RubyContainerFrame {
            let containerStart: Double?
            let containerEnd: Double?
            var basePieces: [TimedPiece] = []
            var rubyPieces: [TimedPiece] = []
            var directBaseText: String = ""
        }

        private struct WordSpanFrame {
            let start: Double
            let end: Double
            var text: String = ""
            var rubies: [LyricRubyPayload] = []
        }

        private var mainWords: [LyricWordPayload] = []
        private var mainPendingSpace = false
        private var mainTransBuf = ""
        private var mainTransByLang: [String: String] = [:]
        private var mainRomaBuf = ""
        private var mainRomaSpans: [RomanizationAligner.TimedSpan] = []
        private var mainRomaCaptured = false

        private var inBgSpan = false
        private var bgStart: Double = 0
        private var bgEnd: Double = 0
        private var bgAgent: String? = nil
        private var bgWords: [LyricWordPayload] = []
        private var bgPendingSpace = false
        private var bgTransBuf = ""
        private var bgTransByLang: [String: String] = [:]
        private var bgRomaBuf = ""
        private var bgRomaSpans: [RomanizationAligner.TimedSpan] = []
        private var bgRomaCaptured = false
        private var activeInlineRomaSpan: (start: Double, end: Double, forBg: Bool, buf: String)? = nil

        private var spanStack: [SpanEntry] = []
        private var wordFrameStack: [WordSpanFrame] = []
        private var rubyContainerStack: [RubyContainerFrame] = []
        private var activePieceStack: [TimedPiece] = []
        private var inRt = false
        private var rtText = ""

        private var activeTransSpanIndex: Int? {
            spanStack.lastIndex(where: { $0.role == "x-translation" })
        }

        private var isInsideRomanSpan: Bool {
            spanStack.contains(where: { $0.role == "x-roman" })
        }

        private var isInsideRubyDelimiter: Bool {
            spanStack.contains(where: { $0.rubyRole == "delimiter" })
        }

        private var isInsideRubyTextZone: Bool {
            spanStack.contains(where: { $0.rubyRole == "textContainer" || $0.rubyRole == "text" })
        }

        private func flushPendingSpace(forBg: Bool) {
            if forBg {
                guard bgPendingSpace else { return }
                bgPendingSpace = false
                if !bgWords.isEmpty {
                    let last = bgWords[bgWords.count - 1]
                    bgWords[bgWords.count - 1] = LyricWordPayload(
                        text: last.text + " ",
                        start: last.start,
                        end: last.end,
                        ruby: last.ruby
                    )
                }
            } else {
                guard mainPendingSpace else { return }
                mainPendingSpace = false
                if !mainWords.isEmpty {
                    let last = mainWords[mainWords.count - 1]
                    mainWords[mainWords.count - 1] = LyricWordPayload(
                        text: last.text + " ",
                        start: last.start,
                        end: last.end,
                        ruby: last.ruby
                    )
                }
            }
        }

        private func appendUntimedText(_ raw: String) {
            let cleaned = raw.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
            guard !cleaned.isEmpty else { return }
            flushPendingSpace(forBg: inBgSpan)
            if inBgSpan {
                if !bgWords.isEmpty {
                    let last = bgWords[bgWords.count - 1]
                    bgWords[bgWords.count - 1] = LyricWordPayload(
                        text: last.text + cleaned,
                        start: last.start,
                        end: last.end,
                        ruby: last.ruby
                    )
                } else {
                    let stripped = Self.stripOuterParensIfBg(cleaned, isBg: true)
                    if !stripped.isEmpty {
                        bgWords.append(LyricWordPayload(text: stripped, start: bgStart, end: bgEnd))
                    }
                }
            } else {
                if !mainWords.isEmpty {
                    let last = mainWords[mainWords.count - 1]
                    mainWords[mainWords.count - 1] = LyricWordPayload(
                        text: last.text + cleaned,
                        start: last.start,
                        end: last.end,
                        ruby: last.ruby
                    )
                } else {
                    mainWords.append(LyricWordPayload(text: cleaned, start: pStart, end: pEnd))
                }
            }
        }

        private func flushWordFrame(_ frame: WordSpanFrame) {
            guard !frame.text.isEmpty else { return }
            let we = max(frame.start, frame.end)
            let cleanText = Self.stripOuterParensIfBg(frame.text, isBg: inBgSpan && bgWords.isEmpty)
            guard !cleanText.isEmpty else { return }
            flushPendingSpace(forBg: inBgSpan)
            let word = LyricWordPayload(
                text: cleanText,
                start: frame.start,
                end: we,
                ruby: frame.rubies.isEmpty ? nil : frame.rubies
            )
            if inBgSpan {
                bgWords.append(word)
            } else {
                mainWords.append(word)
            }
        }

        /// 1:1 对齐 web/src/lib/lyrics/ttml-ruby.ts parseTtmlRubyContainer（支持 container / base / text 任一层级标时间及多行缩进格式）
        private func flushRubyContainer(_ container: RubyContainerFrame) {
            let cleanedDirect = container.directBaseText
                .replacingOccurrences(of: "[\r\n]+", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let baseText = !container.basePieces.isEmpty
                ? container.basePieces.map(\.text).joined()
                : cleanedDirect
            guard !baseText.isEmpty else { return }

            var rubyPieces = container.rubyPieces.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            if !rubyPieces.isEmpty {
                let lastIdx = rubyPieces.count - 1
                rubyPieces[lastIdx].text = rubyPieces[lastIdx].text.replacingOccurrences(
                    of: "\\s+$",
                    with: "",
                    options: .regularExpression
                )
                rubyPieces = rubyPieces.filter { !$0.text.isEmpty }
            }

            let baseStarts = container.basePieces.compactMap(\.start)
            let baseEnds = container.basePieces.compactMap { $0.end ?? $0.start }
            let rubyStarts = rubyPieces.compactMap(\.start)
            let rubyEnds = rubyPieces.compactMap { $0.end ?? $0.start }

            let startOpt = baseStarts.min() ?? container.containerStart ?? rubyStarts.min()
            let endOpt = baseEnds.max() ?? container.containerEnd ?? rubyEnds.max()

            guard let wordStart = startOpt, let rawEnd = endOpt else {
                appendUntimedText(baseText)
                return
            }
            let wordEnd = max(wordStart, rawEnd)

            var rubies: [LyricRubyPayload] = []
            if !rubyPieces.isEmpty {
                let allTimed = rubyPieces.allSatisfy { $0.start != nil }
                    && (wordStart <= 0 || rubyPieces.contains { ($0.start ?? 0) > 0 || ($0.end ?? 0) > 0 })
                if allTimed {
                    for piece in rubyPieces where !piece.text.isEmpty {
                        let s = min(max(piece.start!, wordStart), wordEnd)
                        let e = min(max(piece.end ?? s, s), wordEnd)
                        rubies.append(LyricRubyPayload(text: piece.text, start: s, end: e))
                    }
                } else {
                    let expanded: [String]
                    if rubyPieces.count == 1 && rubyPieces[0].text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil {
                        expanded = rubyPieces[0].text.map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                    } else {
                        expanded = rubyPieces.map(\.text).filter { !$0.isEmpty }
                    }
                    if !expanded.isEmpty {
                        let step = (wordEnd - wordStart) / Double(expanded.count)
                        for (idx, ch) in expanded.enumerated() {
                            let s = wordStart + Double(idx) * step
                            let e = idx == expanded.count - 1 ? wordEnd : (wordStart + Double(idx + 1) * step)
                            rubies.append(LyricRubyPayload(text: ch, start: s, end: max(s, e)))
                        }
                    }
                }
            }

            let cleanText = Self.stripOuterParensIfBg(baseText, isBg: inBgSpan && bgWords.isEmpty)
            guard !cleanText.isEmpty else { return }
            flushPendingSpace(forBg: inBgSpan)
            let word = LyricWordPayload(
                text: cleanText,
                start: wordStart,
                end: wordEnd,
                ruby: rubies.isEmpty ? nil : rubies
            )
            if inBgSpan {
                bgWords.append(word)
            } else {
                mainWords.append(word)
            }
        }

        func parser(
            _ parser: XMLParser,
            didStartElement elementName: String,
            namespaceURI: String?,
            qualifiedName qName: String?,
            attributes attributeDict: [String: String] = [:]
        ) {
            let local = elementName.components(separatedBy: ":").last ?? elementName
            switch local {
            case "agent":
                currentAgentId = attributeDict["xml:id"] ?? attributeDict["id"]
                currentAgentType = attributeDict["type"]
                agentNameBuf = ""

            case "name" where currentAgentId != nil:
                capturingAgentName = true
                agentNameBuf = ""

            case "transliteration":
                inTransliterationBlock = true
                let rawLang = (attributeDict["xml:lang"] ?? attributeDict["lang"] ?? "").lowercased()
                translitBlockIsLatn = rawLang.hasSuffix("-latn") || rawLang == "latn"

            case "text" where inTransliterationBlock:
                currentTranslitKey = attributeDict["for"]
                translitFullBuf = ""
                translitMainBuf = ""
                translitMainSpans = []
                translitInBg = false
                translitBgStart = nil
                translitBgEnd = nil
                translitBgBuf = ""
                translitBgSpans = []
                translitActiveSpan = nil
                translitSpanDepth = 0

            case "span" where currentTranslitKey != nil && !inP:
                let role = attributeDict["ttm:role"] ?? attributeDict["role"] ?? ""
                let sStart = Self.parseTTMLTime(attributeDict["begin"])
                let sEnd = Self.parseTTMLTime(attributeDict["end"])
                translitSpanDepth += 1
                if !translitInBg && translitSpanDepth == 1 && role == "x-bg" {
                    translitInBg = true
                    translitBgStart = sStart
                    translitBgEnd = sEnd
                } else if (!translitInBg && translitSpanDepth == 1 && role.isEmpty)
                            || (translitInBg && translitSpanDepth == 2) {
                    translitActiveSpan = (start: sStart, end: sEnd, forBg: translitInBg, buf: "")
                }

            case "div":
                if !lines.isEmpty {
                    nextDivStartsParagraph = true
                }

            case "p":
                inP = true
                pKey = attributeDict["itunes:key"] ?? attributeDict["key"]
                pStart = Self.parseTTMLTime(attributeDict["begin"]) ?? 0
                pEnd = Self.parseTTMLTime(attributeDict["end"]) ?? pStart
                pAgent = attributeDict["ttm:agent"] ?? attributeDict["agent"]
                pParagraphStart = nextDivStartsParagraph
                nextDivStartsParagraph = false
                mainWords = []
                mainPendingSpace = false
                mainTransBuf = ""
                mainTransByLang = [:]
                mainRomaBuf = ""
                mainRomaSpans = []
                mainRomaCaptured = false
                bgAgent = nil
                bgWords = []
                bgPendingSpace = false
                bgTransBuf = ""
                bgTransByLang = [:]
                bgRomaBuf = ""
                bgRomaSpans = []
                bgRomaCaptured = false
                activeInlineRomaSpan = nil
                spanStack = []
                wordFrameStack = []
                rubyContainerStack = []
                activePieceStack = []

            case "span" where inP:
                let role = attributeDict["ttm:role"] ?? attributeDict["role"] ?? ""
                let rubyRole = attributeDict["tts:ruby"] ?? attributeDict["ruby"] ?? ""
                let rawLang = attributeDict["xml:lang"] ?? attributeDict["lang"]
                let normLang = Self.normalizeLangTag(rawLang)
                let spanStart = Self.parseTTMLTime(attributeDict["begin"])
                let spanEnd = Self.parseTTMLTime(attributeDict["end"])

                var pushedWord = false
                var pushedRubyContainer = false
                var pushedRubyPiece = false
                var isBasePiece = false
                var pushedInlineRoma = false

                if role == "x-bg" {
                    inBgSpan = true
                    bgStart = spanStart ?? pStart
                    bgEnd = spanEnd ?? pEnd
                    if let explicitBgAgent = attributeDict["ttm:agent"] ?? attributeDict["agent"], !explicitBgAgent.isEmpty {
                        bgAgent = explicitBgAgent
                    }
                } else if isInsideRomanSpan {
                    let alreadyCaptured = inBgSpan ? bgRomaCaptured : mainRomaCaptured
                    if !alreadyCaptured, activeInlineRomaSpan == nil, let s = spanStart, let e = spanEnd {
                        activeInlineRomaSpan = (start: s, end: max(s, e), forBg: inBgSpan, buf: "")
                        pushedInlineRoma = true
                    }
                } else if activeTransSpanIndex == nil && role != "x-translation" && role != "x-roman" {
                    if !rubyContainerStack.isEmpty {
                        if rubyRole == "text" || (isInsideRubyTextZone && rubyRole != "delimiter" && rubyRole != "textContainer") {
                            let inheritedStart = spanStart ?? activePieceStack.last?.start
                            let inheritedEnd = spanEnd ?? activePieceStack.last?.end
                            activePieceStack.append(TimedPiece(start: inheritedStart, end: inheritedEnd))
                            pushedRubyPiece = true
                            isBasePiece = false
                        } else if rubyRole == "base" || (!isInsideRubyTextZone && rubyRole != "delimiter" && rubyRole != "textContainer") {
                            let inheritedStart = spanStart ?? activePieceStack.last?.start
                            let inheritedEnd = spanEnd ?? activePieceStack.last?.end
                            activePieceStack.append(TimedPiece(start: inheritedStart, end: inheritedEnd))
                            pushedRubyPiece = true
                            isBasePiece = true
                        }
                    } else if rubyRole == "container" {
                        if var parent = wordFrameStack.popLast() {
                            if !parent.text.isEmpty || !parent.rubies.isEmpty {
                                flushWordFrame(parent)
                                parent.text = ""
                                parent.rubies = []
                            }
                            wordFrameStack.append(parent)
                        }
                        rubyContainerStack.append(RubyContainerFrame(containerStart: spanStart, containerEnd: spanEnd))
                        pushedRubyContainer = true
                    } else if rubyRole != "delimiter" && rubyRole != "text" && rubyRole != "textContainer",
                              let s = spanStart {
                        // 若外层词 span 已有前置文本，在进入带独立时间戳的子 span（如嵌套 x-ruby）前先落盘前置片段，保留外层帧供后续文本继续继承时间
                        if var parent = wordFrameStack.popLast() {
                            if !parent.text.isEmpty || !parent.rubies.isEmpty {
                                flushWordFrame(parent)
                                parent.text = ""
                                parent.rubies = []
                            }
                            wordFrameStack.append(parent)
                        }
                        let e = spanEnd ?? s
                        wordFrameStack.append(WordSpanFrame(start: s, end: e))
                        pushedWord = true
                    }
                }
                spanStack.append(
                    SpanEntry(
                        role: role,
                        rubyRole: rubyRole,
                        lang: normLang,
                        pushedWordFrame: pushedWord,
                        pushedRubyContainer: pushedRubyContainer,
                        pushedRubyPiece: pushedRubyPiece,
                        isRubyBasePiece: isBasePiece,
                        pushedInlineRomaSpan: pushedInlineRoma
                    )
                )

            case "rt" where inP:
                inRt = true
                rtText = ""

            default:
                break
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            if capturingAgentName {
                agentNameBuf += string
                return
            }
            if currentTranslitKey != nil && !inP {
                translitFullBuf += string
                if translitInBg {
                    translitBgBuf += string
                } else {
                    translitMainBuf += string
                }
                if translitActiveSpan != nil {
                    translitActiveSpan?.buf += string
                }
                return
            }
            guard inP else { return }
            if let transIdx = activeTransSpanIndex {
                let lang = spanStack[transIdx].lang
                if inBgSpan {
                    if let lang {
                        bgTransByLang[lang, default: ""] += string
                        if bgTransBuf.isEmpty { bgTransBuf += string }
                    } else {
                        bgTransBuf += string
                    }
                } else {
                    if let lang {
                        mainTransByLang[lang, default: ""] += string
                        if mainTransBuf.isEmpty { mainTransBuf += string }
                    } else {
                        mainTransBuf += string
                    }
                }
            } else if isInsideRomanSpan {
                let alreadyCaptured = inBgSpan ? bgRomaCaptured : mainRomaCaptured
                if !alreadyCaptured {
                    if inBgSpan { bgRomaBuf += string } else { mainRomaBuf += string }
                    if activeInlineRomaSpan != nil {
                        activeInlineRomaSpan?.buf += string
                    }
                }
            } else if isInsideRubyDelimiter {
                return
            } else if inRt {
                rtText += string
            } else if !rubyContainerStack.isEmpty {
                let noNewlines = string.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
                if !activePieceStack.isEmpty {
                    let topIdx = activePieceStack.count - 1
                    if noNewlines.trimmingCharacters(in: .whitespaces).isEmpty {
                        if isInsideRubyTextZone,
                           noNewlines.contains(" "),
                           !activePieceStack[topIdx].text.isEmpty,
                           !activePieceStack[topIdx].text.hasSuffix(" ") {
                            activePieceStack[topIdx].text += " "
                        }
                    } else {
                        activePieceStack[topIdx].text += noNewlines
                    }
                } else if !isInsideRubyTextZone {
                    if !noNewlines.trimmingCharacters(in: .whitespaces).isEmpty {
                        rubyContainerStack[rubyContainerStack.count - 1].directBaseText += noNewlines
                    }
                }
            } else if !wordFrameStack.isEmpty {
                wordFrameStack[wordFrameStack.count - 1].text += string
            } else {
                // 相邻词 span 之间的同行显式空格（不含换行缩进）记入 pendingSpace，后续若紧跟正文词则作为词间空格挂到上一词末尾
                if string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    let isInlineWordSpace = !string.contains("\n") && !string.contains("\r") && !string.isEmpty
                    if isInlineWordSpace {
                        if inBgSpan {
                            bgPendingSpace = !bgWords.isEmpty
                        } else {
                            mainPendingSpace = !mainWords.isEmpty
                        }
                    }
                } else {
                    appendUntimedText(string)
                }
            }
        }

        func parser(
            _ parser: XMLParser,
            didEndElement elementName: String,
            namespaceURI: String?,
            qualifiedName qName: String?
        ) {
            let local = elementName.components(separatedBy: ":").last ?? elementName
            switch local {
            case "name" where capturingAgentName:
                capturingAgentName = false

            case "agent":
                if let aid = currentAgentId {
                    let trimmed = agentNameBuf.trimmingCharacters(in: .whitespacesAndNewlines)
                    agents[aid] = (
                        name: trimmed.isEmpty ? nil : trimmed,
                        isGroup: currentAgentType == "group" || aid == "v1000",
                        members: []
                    )
                }
                currentAgentId = nil
                currentAgentType = nil

            case "span" where currentTranslitKey != nil && !inP:
                if let active = translitActiveSpan,
                   (!translitInBg && translitSpanDepth == 1) || (translitInBg && translitSpanDepth == 2) {
                    translitActiveSpan = nil
                    let collapsed = Self.collapseWhitespace(active.buf)
                    if let s = active.start, let e = active.end, !collapsed.isEmpty {
                        let span = RomanizationAligner.TimedSpan(text: collapsed, start: s, end: max(s, e))
                        if active.forBg {
                            translitBgSpans.append(span)
                        } else {
                            translitMainSpans.append(span)
                        }
                    }
                }
                if translitInBg && translitSpanDepth == 1 {
                    translitInBg = false
                }
                translitSpanDepth = max(0, translitSpanDepth - 1)

            case "text" where inTransliterationBlock:
                if let key = currentTranslitKey, !key.isEmpty {
                    let full = Self.collapseWhitespace(translitFullBuf)
                    let isValidLatin = !full.isEmpty
                        && RomanizationAligner.containsLatinLetter(full)
                        && !RomanizationAligner.containsCJK(full)
                    let existing = transliterationsByKey[key]
                    let canAccept = existing == nil || (translitBlockIsLatn && existing?.isLatnPreferred == false)
                    if isValidLatin && canAccept {
                        let mText = Self.collapseWhitespace(translitMainBuf)
                        let bText = Self.collapseWhitespace(translitBgBuf)
                        var bSpans = translitBgSpans
                        if bSpans.isEmpty, !bText.isEmpty, let bs = translitBgStart, let be = translitBgEnd {
                            bSpans = [RomanizationAligner.TimedSpan(text: bText, start: bs, end: max(bs, be))]
                        }
                        if !mText.isEmpty || !bText.isEmpty {
                            transliterationsByKey[key] = KeyedRomanEntry(
                                isLatnPreferred: translitBlockIsLatn,
                                mainText: mText,
                                mainSpans: translitMainSpans,
                                bgText: bText,
                                bgSpans: bSpans
                            )
                        }
                    }
                }
                currentTranslitKey = nil
                translitActiveSpan = nil
                translitInBg = false
                translitSpanDepth = 0

            case "transliteration":
                inTransliterationBlock = false
                currentTranslitKey = nil

            case "rt" where inP:
                inRt = false
                let trimmed = rtText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, let top = wordFrameStack.last {
                    wordFrameStack[wordFrameStack.count - 1].rubies.append(
                        LyricRubyPayload(text: trimmed, start: top.start, end: max(top.start, top.end))
                    )
                }

            case "span" where inP:
                guard let popped = spanStack.popLast() else { break }
                if popped.pushedInlineRomaSpan, let active = activeInlineRomaSpan {
                    activeInlineRomaSpan = nil
                    let collapsed = Self.collapseWhitespace(active.buf)
                    if !collapsed.isEmpty {
                        let span = RomanizationAligner.TimedSpan(text: collapsed, start: active.start, end: active.end)
                        if active.forBg {
                            bgRomaSpans.append(span)
                        } else {
                            mainRomaSpans.append(span)
                        }
                    }
                }
                if popped.role == "x-roman" && !spanStack.contains(where: { $0.role == "x-roman" }) {
                    if inBgSpan {
                        if !Self.collapseWhitespace(bgRomaBuf).isEmpty { bgRomaCaptured = true }
                    } else {
                        if !Self.collapseWhitespace(mainRomaBuf).isEmpty { mainRomaCaptured = true }
                    }
                }
                if popped.role == "x-bg" {
                    inBgSpan = spanStack.contains(where: { $0.role == "x-bg" })
                    bgPendingSpace = false
                } else if popped.pushedRubyPiece, var piece = activePieceStack.popLast() {
                    let trimmed = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty, !rubyContainerStack.isEmpty {
                        if popped.isRubyBasePiece {
                            piece.text = trimmed
                            rubyContainerStack[rubyContainerStack.count - 1].basePieces.append(piece)
                        } else {
                            piece.text = piece.text.hasSuffix(" ") ? "\(trimmed) " : trimmed
                            rubyContainerStack[rubyContainerStack.count - 1].rubyPieces.append(piece)
                        }
                    }
                } else if popped.pushedRubyContainer, let container = rubyContainerStack.popLast() {
                    flushRubyContainer(container)
                } else if popped.pushedWordFrame, let finished = wordFrameStack.popLast() {
                    flushWordFrame(finished)
                }

            case "p" where inP:
                inP = false
                while let leftover = wordFrameStack.popLast() {
                    flushWordFrame(leftover)
                }

                if let key = pKey, let keyed = transliterationsByKey[key] {
                    if Self.collapseWhitespace(mainRomaBuf).isEmpty && !keyed.mainText.isEmpty {
                        mainRomaBuf = keyed.mainText
                        mainRomaSpans = keyed.mainSpans
                    }
                    if Self.collapseWhitespace(bgRomaBuf).isEmpty && !keyed.bgText.isEmpty {
                        bgRomaBuf = keyed.bgText
                        bgRomaSpans = keyed.bgSpans
                    }
                }
                pKey = nil

                // 整段 <p> 仅有 <span ttm:role="x-bg"> 而无主唱正文时，按 parse-ttml.ts 规则提升为主行而非作为孤儿副行
                var effectiveMainWords = mainWords
                var effectiveBgWords = bgWords
                var effectiveMainAgent = pAgent
                var effectiveMainTransBuf = mainTransBuf
                var effectiveMainTransByLang = mainTransByLang
                var effectiveMainRomaBuf = mainRomaBuf
                var effectiveMainRomaSpans = mainRomaSpans

                if effectiveMainWords.isEmpty && !effectiveBgWords.isEmpty {
                    effectiveMainWords = Self.trimWrappingParens(effectiveBgWords)
                    effectiveBgWords = []
                    effectiveMainAgent = bgAgent ?? pAgent
                    if effectiveMainTransBuf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        effectiveMainTransBuf = bgTransBuf
                    }
                    for (k, v) in bgTransByLang {
                        effectiveMainTransByLang[k] = v
                    }
                    if Self.collapseWhitespace(effectiveMainRomaBuf).isEmpty {
                        effectiveMainRomaBuf = bgRomaBuf
                        effectiveMainRomaSpans = bgRomaSpans
                    }
                }

                var builtMain: MutableLine? = nil
                if !effectiveMainWords.isEmpty {
                    let end = max(pEnd, effectiveMainWords.last?.end ?? pStart)
                    let start = effectiveMainWords.first?.start ?? pStart
                    let cleanedLangMap = effectiveMainTransByLang.reduce(into: [String: String]()) { acc, kv in
                        let v = kv.value.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !v.isEmpty { acc[kv.key] = v }
                    }
                    let transRaw = effectiveMainTransBuf.trimmingCharacters(in: .whitespacesAndNewlines)
                    let trans = !transRaw.isEmpty ? transRaw : cleanedLangMap["zh"] ?? cleanedLangMap.values.first
                    let roma = Self.collapseWhitespace(effectiveMainRomaBuf)
                    let mainRomaWords = !effectiveMainRomaSpans.isEmpty
                        ? RomanizationAligner.sanitizeForPayload(
                            RomanizationAligner.romanWordsFromSpans(effectiveMainRomaSpans, words: effectiveMainWords) ?? []
                        )
                        : []
                    builtMain = MutableLine(
                        start: start,
                        end: end,
                        paragraphStart: pParagraphStart,
                        agentId: effectiveMainAgent,
                        translation: trans?.isEmpty == false ? trans : nil,
                        translationsByLang: cleanedLangMap,
                        romanization: roma.isEmpty ? nil : roma,
                        romanizationWords: mainRomaWords,
                        words: effectiveMainWords
                    )
                }

                var builtBg: MutableLine? = nil
                if !effectiveBgWords.isEmpty {
                    let cleanedBg = Self.trimWrappingParens(effectiveBgWords)
                    if !cleanedBg.isEmpty {
                        let bStart = cleanedBg.first?.start ?? bgStart
                        let bEnd = max(bgEnd, cleanedBg.last?.end ?? bStart)
                        let cleanedBgLangMap = bgTransByLang.reduce(into: [String: String]()) { acc, kv in
                            let v = kv.value.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !v.isEmpty { acc[kv.key] = v }
                        }
                        let bTransRaw = bgTransBuf.trimmingCharacters(in: .whitespacesAndNewlines)
                        let bTrans = !bTransRaw.isEmpty ? bTransRaw : cleanedBgLangMap["zh"] ?? cleanedBgLangMap.values.first
                        let bRoma = Self.collapseWhitespace(bgRomaBuf)
                        let bgRomaWords = !bgRomaSpans.isEmpty
                            ? RomanizationAligner.sanitizeForPayload(
                                RomanizationAligner.romanWordsFromSpans(bgRomaSpans, words: cleanedBg) ?? []
                            )
                            : []
                        builtBg = MutableLine(
                            start: bStart,
                            end: bEnd,
                            isBackground: true,
                            align: builtMain?.align ?? "left",
                            agentId: bgAgent ?? effectiveMainAgent,
                            translation: bTrans?.isEmpty == false ? bTrans : nil,
                            translationsByLang: cleanedBgLangMap,
                            romanization: bRoma.isEmpty ? nil : bRoma,
                            romanizationWords: bgRomaWords,
                            words: cleanedBg
                        )
                    }
                }

                if let mainLine = builtMain, var bgLine = builtBg {
                    let mainFirstStart = mainLine.words.first?.start ?? mainLine.start
                    if bgLine.start < mainFirstStart {
                        bgLine.backgroundPosition = "above"
                        bgLine.owner = lines.count + 1
                        lines.append(bgLine)
                        lines.append(mainLine)
                    } else {
                        bgLine.backgroundPosition = "below"
                        bgLine.owner = lines.count
                        lines.append(mainLine)
                        lines.append(bgLine)
                    }
                } else if let mainLine = builtMain {
                    lines.append(mainLine)
                }

            default:
                break
            }
        }

        private static func collapseWhitespace(_ s: String) -> String {
            s.components(separatedBy: .whitespacesAndNewlines)
                .filter { !$0.isEmpty }
                .joined(separator: " ")
        }

        private static func stripOuterParensIfBg(_ s: String, isBg: Bool) -> String {
            guard isBg else { return s }
            if s.hasPrefix("(") || s.hasPrefix("（") {
                return String(s.dropFirst())
            }
            return s
        }

        private static func trimWrappingParens(_ words: [LyricWordPayload]) -> [LyricWordPayload] {
            guard var copy = Optional(words), !copy.isEmpty else { return [] }
            let lastIdx = copy.count - 1
            let lastText = copy[lastIdx].text
            if lastText.hasSuffix(")") || lastText.hasSuffix("）") {
                let stripped = String(lastText.dropLast())
                if stripped.isEmpty {
                    copy.removeLast()
                } else {
                    copy[lastIdx] = LyricWordPayload(
                        text: stripped,
                        start: copy[lastIdx].start,
                        end: copy[lastIdx].end,
                        ruby: copy[lastIdx].ruby
                    )
                }
            }
            return copy
        }

        private static func parseTTMLTime(_ raw: String?) -> Double? {
            guard let s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
            if s.hasSuffix("ms"), let v = Double(s.dropLast(2)) { return v }
            if s.hasSuffix("s"), let v = Double(s.dropLast(1)) { return v * 1000.0 }
            let parts = s.split(separator: ":")
            if parts.count == 3,
               let h = Double(parts[0]), let m = Double(parts[1]), let sec = Double(parts[2]) {
                return (h * 3600.0 + m * 60.0 + sec) * 1000.0
            }
            if parts.count == 2,
               let m = Double(parts[0]), let sec = Double(parts[1]) {
                return (m * 60.0 + sec) * 1000.0
            }
            return Double(s).map { $0 * 1000.0 }
        }

        private static func normalizeLangTag(_ raw: String?) -> String? {
            guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !raw.isEmpty else {
                return nil
            }
            if raw.hasPrefix("zh-hant") || raw == "zh-tw" || raw == "zh-mo" { return "zh-tw" }
            if raw == "zh-hk" { return "zh-hk" }
            if raw.hasPrefix("zh") { return "zh" }
            if let primary = raw.split(separator: "-").first, !primary.isEmpty {
                return String(primary)
            }
            return raw
        }
    }

    // MARK: - 叠加 AI 强调标注、多语言翻译、音译、歌手分轨与间奏生成

    private static func applyOverlays(
        base: BaseParsedLyrics,
        annotations: BackendAnnotationsDTO?,
        primarySlot: TranslationSelectionItem,
        primaryTranslations: BackendTranslationsDTO?,
        secondarySlot: TranslationSelectionItem?,
        secondaryTranslations: BackendTranslationsDTO?,
        pronunciations: BackendPronunciationsDTO?,
        singers: BackendSingersDTO?
    ) -> LyricsBundlePayload {
        if base.lines.isEmpty {
            return LyricsBundlePayload(
                source: base.source,
                sourceName: base.sourceName,
                font: annotations?.font,
                motion: annotations?.motion,
                wordSynced: base.wordSynced,
                instrumental: base.instrumental,
                spotlights: [],
                interludes: [],
                lines: []
            )
        }

        var lines = base.lines

        // 1. 歌手分轨与颜色条（TTML 原生 agent + 后端 singers 标注）
        let defaultPalette = ["sky", "rose", "mint", "amber", "lavender", "coral"]
        var agentMeta: [String: (name: String?, hex: String, align: String, isGroup: Bool, members: [String])] = [:]
        var soloOrder: [String] = []

        for (idx, kv) in base.ttmlAgents.sorted(by: { $0.key < $1.key }).enumerated() {
            let colorName = defaultPalette[idx % defaultPalette.count]
            let isGroup = kv.value.isGroup
            if !isGroup { soloOrder.append(kv.key) }
            let align = isGroup ? "center" : (soloOrder.count % 2 == 0 ? "right" : "left")
            agentMeta[kv.key] = (
                name: kv.value.name,
                hex: LyricColorPalette.resolveHex(colorName),
                align: align,
                isGroup: isGroup,
                members: kv.value.members
            )
        }

        // 先合并 annotations.singers（仅在 TTML 已存在多声部 ttm:agent 时补充声部名与配色，对齐 emphasis.ts），再由独立 /lyric/singers 覆盖精调
        if !base.ttmlAgents.isEmpty,
           let ann = annotations,
           ann.source == nil || ann.source?.isEmpty == true || ann.source == base.source,
           let annSingers = ann.singers {
            for (idx, item) in annSingers.enumerated() {
                guard agentMeta[item.id] != nil else { continue }
                let isGroup = item.role == "group" || item.id == "v1000"
                if !isGroup && !soloOrder.contains(item.id) {
                    soloOrder.append(item.id)
                }
                let displayName = (item.name?.isEmpty == false ? item.name : nil) ?? agentMeta[item.id]?.name
                let hex = item.color.map(LyricColorPalette.resolveHex)
                    ?? agentMeta[item.id]?.hex
                    ?? LyricColorPalette.resolveHex(defaultPalette[idx % defaultPalette.count])
                let align = item.align
                    ?? agentMeta[item.id]?.align
                    ?? (isGroup ? "center" : (soloOrder.firstIndex(of: item.id).map { $0 % 2 == 1 ? "right" : "left" } ?? "left"))
                agentMeta[item.id] = (
                    name: displayName,
                    hex: hex,
                    align: align,
                    isGroup: isGroup,
                    members: item.members ?? agentMeta[item.id]?.members ?? []
                )
            }
        }

        if let sData = singers,
           sData.status == "ready" || sData.status == nil,
           sData.source == nil || sData.source?.isEmpty == true || sData.source == base.source,
           let sItems = sData.singers {
            for (idx, item) in sItems.enumerated() {
                let isGroup = item.role == "group" || item.id == "v1000"
                if !isGroup && !soloOrder.contains(item.id) {
                    soloOrder.append(item.id)
                }
                let translated = sData.translated_names?[item.id]
                let displayName = (translated?.isEmpty == false ? translated : item.name) ?? agentMeta[item.id]?.name
                let hex = item.color.map(LyricColorPalette.resolveHex) ?? agentMeta[item.id]?.hex ?? LyricColorPalette.resolveHex(defaultPalette[idx % defaultPalette.count])
                let align = item.align ?? agentMeta[item.id]?.align ?? (isGroup ? "center" : (idx % 2 == 1 ? "right" : "left"))
                agentMeta[item.id] = (
                    name: displayName,
                    hex: hex,
                    align: align,
                    isGroup: isGroup,
                    members: item.members ?? []
                )
            }
            if let sLines = sData.lines {
                var mainOcc: [String: Int] = [:]
                var bgOcc: [String: Int] = [:]
                for i in lines.indices {
                    let norm = normalizeMatchText(lines[i].plainText)
                    let occ: Int
                    if lines[i].isBackground {
                        occ = bgOcc[norm, default: 0]
                        bgOcc[norm] = occ + 1
                    } else {
                        occ = mainOcc[norm, default: 0]
                        mainOcc[norm] = occ + 1
                    }
                    if let matched = sLines.first(where: {
                        ($0.bg ?? false) == lines[i].isBackground && $0.occurrence == occ && normalizeMatchText($0.text) == norm
                    }) {
                        lines[i].agentId = matched.agent
                    }
                }
            }
        }

        let soloCount = soloOrder.count
        for i in lines.indices {
            if let aid = lines[i].agentId, let meta = agentMeta[aid] {
                if !lines[i].isBackground {
                    lines[i].align = meta.align
                    lines[i].isDuet = (meta.align == "right")
                }
                if meta.isGroup {
                    let memberHexes = meta.members.compactMap { agentMeta[$0]?.hex }
                    if memberHexes.count >= 2 {
                        lines[i].edgeColors = Array(memberHexes.prefix(6))
                    } else {
                        let c1 = soloOrder.first.flatMap { agentMeta[$0]?.hex } ?? meta.hex
                        let c2 = soloOrder.dropFirst().first.flatMap { agentMeta[$0]?.hex } ?? meta.hex
                        lines[i].edgeColors = [c1, c2]
                    }
                    if !lines[i].isBackground {
                        lines[i].singerName = meta.name ?? "合唱"
                    }
                } else {
                    lines[i].edgeColors = [meta.hex]
                    if !lines[i].isBackground {
                        if let name = meta.name, !name.isEmpty {
                            lines[i].singerName = name
                        } else if soloCount > 2 {
                            lines[i].singerDotOnly = true
                        }
                    }
                }
            } else if lines[i].isBackground, lines[i].owner >= 0, lines.indices.contains(lines[i].owner) {
                lines[i].align = lines[lines[i].owner].align
            }
        }

        // 2. 双轨多语言翻译与 preferNative 原生/AI 偏好合成（1:1 对齐 web/src/lib/lyrics/lyric-language.ts applyDualLanguageTranslations）
        let sameLangComparison: Bool = {
            guard let sec = secondarySlot else { return false }
            return sec.lang == primarySlot.lang && primarySlot.preferNative != sec.preferNative
        }()

        let primaryTexts = resolveSlotTranslations(
            lines: lines,
            baseSource: base.source,
            slot: primarySlot,
            dto: primaryTranslations,
            sameLangComparison: sameLangComparison
        )
        let secondaryTexts: [String?]? = secondarySlot.map { sec in
            resolveSlotTranslations(
                lines: lines,
                baseSource: base.source,
                slot: sec,
                dto: secondaryTranslations,
                sameLangComparison: sameLangComparison
            )
        }

        for i in lines.indices {
            lines[i].translation = primaryTexts[i]
            if let secTexts = secondaryTexts {
                let p = primaryTexts[i]?.trimmingCharacters(in: .whitespacesAndNewlines)
                let s = secTexts[i]?.trimmingCharacters(in: .whitespacesAndNewlines)
                lines[i].secondaryTranslation = (s != nil && !s!.isEmpty && s != p) ? s : nil
            } else {
                lines[i].secondaryTranslation = nil
            }
        }

        // 2.5 逐行读音合并与同语言自动隐藏（1:1 对齐 web/src/lib/lyrics/lyric-pronunciation.ts applyPronunciationsAndFilter）
        let prMatchesSource: Bool = {
            guard let prData = pronunciations,
                  prData.status == "ready" || prData.status == nil else {
                return false
            }
            return prData.source == nil || prData.source?.isEmpty == true || prData.source == base.source
        }()
        let allPlainTexts = lines.map(\.plainText).filter { !$0.isEmpty }
        let nativeRomajiTexts = lines.compactMap { $0.romanization?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let songLang = RomanizationAligner.detectSongPronunciationLang(
            texts: allPlainTexts,
            nativeRomanizations: nativeRomajiTexts,
            aiSongLang: prMatchesSource ? pronunciations?.lang : nil
        )
        let prLines = prMatchesSource ? (pronunciations?.lines ?? []) : []
        var mainPronOcc: [String: Int] = [:]
        var bgPronOcc: [String: Int] = [:]
        for i in lines.indices {
            let lineText = lines[i].plainText
            let norm = normalizeMatchText(lineText)
            let occ = lines[i].isBackground ? bgPronOcc[norm, default: 0] : mainPronOcc[norm, default: 0]
            if lines[i].isBackground { bgPronOcc[norm] = occ + 1 } else { mainPronOcc[norm] = occ + 1 }

            let aiHit = prLines.first {
                ($0.bg ?? false) == lines[i].isBackground && $0.occurrence == occ && normalizeMatchText($0.text) == norm
            }

            if let nativeRoman = lines[i].romanization?.trimmingCharacters(in: .whitespacesAndNewlines),
               !nativeRoman.isEmpty {
                let lineLang = RomanizationAligner.detectLinePronunciationLang(
                    text: lineText,
                    pron: nativeRoman,
                    songLang: aiHit?.lang ?? songLang
                )
                if RomanizationAligner.shouldHideSameLangPronunciation(lineLang: lineLang, targetLang: primarySlot.lang) {
                    lines[i].romanization = nil
                    lines[i].romanizationWords = []
                }
                continue
            }

            guard let hit = aiHit else { continue }
            let trimmedPron = hit.pronunciation.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedPron.isEmpty else { continue }
            let lineLang = RomanizationAligner.detectLinePronunciationLang(
                text: lineText,
                pron: trimmedPron,
                songLang: hit.lang ?? songLang
            )
            if RomanizationAligner.shouldHideSameLangPronunciation(lineLang: lineLang, targetLang: primarySlot.lang) {
                continue
            }
            lines[i].romanization = trimmedPron
            if base.wordSynced && !lines[i].words.isEmpty,
               let aligned = RomanizationAligner.buildRomanWordsFromAiTokens(
                   words: lines[i].words,
                   tokens: hit.tokens,
                   fallbackPronunciation: trimmedPron
               ) {
                lines[i].romanizationWords = RomanizationAligner.sanitizeForPayload(aligned)
            }
        }

        // 3. AI 强调标注、粒子场景、聚光灯与「时刻」叠加
        var spotlights: [Int] = []
        var notes: [LyricNotePayload] = []
        var sprites: [String: LyricSpritePayload] = [:]

        if let ann = annotations, ann.source == nil || ann.source?.isEmpty == true || ann.source == base.source {
            for sp in ann.sprites ?? [] {
                let paths = (sp.paths ?? []).map { LyricSpritePathPayload(d: $0.d, paint: $0.paint) }
                sprites[sp.name] = LyricSpritePayload(
                    name: sp.name,
                    paths: paths,
                    motion: sp.motion ?? "fall",
                    size: sp.size ?? "m",
                    spin: sp.spin ?? false,
                    colorHex: sp.color.map(LyricColorPalette.resolveHex) ?? "#ffffff"
                )
            }

            let annLinesByNorm: [String: BackendAnnotationLineDTO] = Dictionary(
                (ann.lines ?? []).map { (normalizeMatchText($0.text), $0) },
                uniquingKeysWith: { first, _ in first }
            )

            var mainOccurrences: [String: [Int]] = [:]
            for i in lines.indices where !lines[i].isBackground {
                let norm = normalizeMatchText(lines[i].plainText)
                mainOccurrences[norm, default: []].append(i)

                if let aLine = annLinesByNorm[norm] {
                    lines[i].moodHex = aLine.mood.flatMap { moodHexMap[$0] }
                    lines[i].chorusStart = aLine.chorus_start ?? false
                    lines[i].scene = aLine.scene
                    lines[i].sceneColorHex = aLine.scene_color.map(LyricColorPalette.resolveHex)
                    lines[i].sceneLines = aLine.scene_lines
                    if base.wordSynced, let phrases = aLine.phrases, !phrases.isEmpty {
                        lines[i].emphasis = matchEmphasisPhrases(phrases: phrases, words: lines[i].words)
                    }
                }
            }

            for sp in ann.spotlights ?? [] {
                let norm = normalizeMatchText(sp.text)
                if let list = mainOccurrences[norm], !list.isEmpty {
                    let idx = list[min(max(0, sp.occurrence), list.count - 1)]
                    spotlights.append(idx)
                }
            }
            spotlights = Array(Set(spotlights)).sorted()

            for m in ann.moments ?? [] {
                let norm = normalizeMatchText(m.text)
                if let list = mainOccurrences[norm], !list.isEmpty {
                    let targetLine = lines[list[min(max(0, m.occurrence), list.count - 1)]]
                    notes.append(
                        LyricNotePayload(
                            start: targetLine.start,
                            content: m.content,
                            source: m.source,
                            liked: m.liked
                        )
                    )
                }
            }
            notes.sort { $0.start < $1.start }
        }

        // 4. 生成 ≥ 7000ms 的前奏与间奏三圆点区间（对齐 timeline.ts INTERLUDE_MIN_MS = 7000）
        let interludes = buildInterludes(for: lines)

        let finalLines = lines.map { l in
            LyricLinePayload(
                start: l.start,
                end: l.end,
                isDuet: l.isDuet,
                isBackground: l.isBackground,
                align: l.align,
                owner: l.owner,
                paragraphStart: l.paragraphStart,
                backgroundPosition: l.backgroundPosition,
                chorusStart: l.chorusStart,
                edgeColors: l.edgeColors,
                singerName: l.singerName,
                singerDotOnly: l.singerDotOnly,
                translation: l.translation,
                secondaryTranslation: l.secondaryTranslation,
                romanization: l.romanization,
                romanizationWords: l.romanizationWords,
                moodHex: l.moodHex,
                scene: l.scene,
                sceneColorHex: l.sceneColorHex,
                sceneLines: l.sceneLines,
                words: l.words,
                emphasis: l.emphasis
            )
        }

        let outro = annotations?.outro.map { LyricOutroPayload(content: $0.content, liked: $0.liked ?? 0) }
        return LyricsBundlePayload(
            source: base.source,
            sourceName: base.sourceName,
            font: annotations?.font,
            motion: annotations?.motion,
            wordSynced: base.wordSynced,
            instrumental: base.instrumental,
            spotlights: spotlights,
            sprites: sprites,
            intro: annotations?.intro,
            outro: outro,
            notes: notes,
            interludes: interludes,
            lines: finalLines
        )
    }

    private static func matchEmphasisPhrases(
        phrases: [BackendAnnotationPhraseDTO],
        words: [LyricWordPayload]
    ) -> [LyricEmphasisPayload] {
        guard !words.isEmpty else { return [] }
        var out: [LyricEmphasisPayload] = []
        var searchFrom = 0

        for phrase in phrases {
            let target = normalizeMatchText(phrase.text)
            guard !target.isEmpty else { continue }
            var matchedRange: Range<Int>? = nil

            for startIdx in searchFrom..<words.count {
                var acc = ""
                for endIdx in startIdx..<words.count {
                    acc += normalizeMatchText(words[endIdx].text)
                    if acc == target {
                        matchedRange = startIdx..<(endIdx + 1)
                        break
                    }
                    if acc.count >= target.count && !target.hasPrefix(acc) {
                        break
                    }
                }
                if matchedRange != nil { break }
            }

            if let range = matchedRange {
                searchFrom = range.upperBound
                let wStart = words[range.lowerBound].start
                let wEnd = max(wStart, words[range.upperBound - 1].end)
                let dur = wEnd - wStart
                let charCount = max(1, (range.map { words[$0].text.count }).reduce(0, +))
                let msPerChar = dur / Double(charCount)
                let factor: Double = msPerChar < 90 ? 0 : min(1.0, max(0.45, (msPerChar - 80.0) / 240.0))
                let holdRange: TimeIntervalRange? = (phrase.effect == "shake" && dur >= 950)
                    ? TimeIntervalRange(start: wStart, end: wEnd)
                    : nil

                out.append(
                    LyricEmphasisPayload(
                        from: range.lowerBound,
                        to: range.upperBound,
                        start: wStart,
                        end: wEnd,
                        factor: factor,
                        effect: phrase.effect,
                        colorHex: phrase.color.map(LyricColorPalette.resolveHex),
                        font: phrase.font,
                        styles: phrase.styles ?? [],
                        hold: holdRange
                    )
                )
            }
        }
        return out
    }

    private static func buildInterludes(for lines: [MutableLine]) -> [TimeIntervalRange] {
        let mainLines = lines.filter { !$0.isBackground }
        guard !mainLines.isEmpty else { return [] }
        var out: [TimeIntervalRange] = []
        let minInterludeMs = 7000.0

        if mainLines[0].start >= minInterludeMs {
            out.append(TimeIntervalRange(start: 0, end: mainLines[0].start))
        }
        var maxEndSoFar = mainLines[0].end
        for i in 1..<mainLines.count {
            let nextStart = mainLines[i].start
            if nextStart - maxEndSoFar >= minInterludeMs {
                out.append(TimeIntervalRange(start: maxEndSoFar, end: nextStart))
            }
            maxEndSoFar = max(maxEndSoFar, mainLines[i].end)
        }
        return out
    }

    // MARK: - 1:1 对应 web/src/lib/lyrics/rhythm/model.ts（由分析拍点构建 4 八度脉冲列）

    private static func buildRhythmPayload(from analysis: BackendRhythmAnalysisDTO) -> RhythmDataPayload? {
        let beats = analysis.beats ?? []
        guard analysis.confidence >= 0.22, !beats.isEmpty, analysis.period_ms > 80 else {
            return nil
        }

        let T = analysis.period_ms
        let accentMin = 0.35
        let synthA = accentMin * 0.8
        let loudSpan = max(1e-6, analysis.loud_high - analysis.loud_low)

        struct PulseNode {
            let t: Double
            let a: Double
            let strength: Double
        }

        let source: [PulseNode] = beats.map { b in
            let normLoud = min(1.0, max(0.0, (b.loud - analysis.loud_low) / loudSpan))
            let a = accentMin + (1.0 - accentMin) * normLoud
            return PulseNode(t: b.t, a: a, strength: b.strength)
        }

        var filled: [PulseNode] = []
        var head: [PulseNode] = []
        var ht = source[0].t - T
        while ht > 50 {
            head.append(PulseNode(t: ht, a: synthA, strength: 0))
            ht -= T
        }
        filled.append(contentsOf: head.reversed())

        for i in 0..<source.count {
            filled.append(source[i])
            guard i + 1 < source.count else { break }
            let gap = source[i + 1].t - source[i].t
            if gap > 1.5 * T {
                let m = max(2, Int(round(gap / T)))
                for j in 1..<m {
                    filled.append(PulseNode(t: source[i].t + gap * Double(j) / Double(m), a: synthA, strength: 0))
                }
            }
        }
        if let lastT = source.last?.t {
            var tt = lastT + T
            while tt < analysis.duration_ms - 50 {
                filled.append(PulseNode(t: tt, a: synthA, strength: 0))
                tt += T
            }
        }

        var levelMap: [Int: [PulseNode]] = [0: filled]
        for k in 1...4 {
            let prev = levelMap[k - 1] ?? []
            var even = 0.0
            var odd = 0.0
            for (idx, p) in prev.enumerated() {
                if idx % 2 == 1 { odd += p.strength } else { even += p.strength }
            }
            let keep = odd > even ? 1 : 0
            levelMap[k] = prev.enumerated().compactMap { $0.offset % 2 == keep ? $0.element : nil }
        }
        for k in stride(from: -1, through: -4, by: -1) {
            let prev = levelMap[k + 1] ?? []
            var nextOut: [PulseNode] = []
            for i in 0..<prev.count {
                nextOut.append(prev[i])
                if i + 1 < prev.count {
                    nextOut.append(PulseNode(t: (prev[i].t + prev[i + 1].t) * 0.5, a: prev[i].a * 0.85, strength: 0))
                }
            }
            levelMap[k] = nextOut
        }

        var basePeriod = analysis.base_period_ms > 80 ? analysis.base_period_ms : T
        while basePeriod < 380 { basePeriod *= 2.0 }
        while basePeriod > 1100 { basePeriod *= 0.5 }
        let baseK = Int(round(log2(basePeriod / T)))

        func compact(octave: Int) -> [[Double]] {
            let clamped = min(4, max(-4, baseK + octave))
            return (levelMap[clamped] ?? []).map { p in
                [(p.t * 10.0).rounded() / 10.0, (p.a * 1000.0).rounded() / 1000.0]
            }
        }

        return RhythmDataPayload(
            reliable: true,
            basePeriodMs: basePeriod,
            trains: [
                "-1": compact(octave: -1),
                "0": compact(octave: 0),
                "1": compact(octave: 1),
                "2": compact(octave: 2)
            ]
        )
    }

    // MARK: - 单轨/双轨翻译槽位解析与网络辅助

    private static func hasNativeTranslation(in lines: [MutableLine], for lang: String) -> Bool {
        if lines.contains(where: { ($0.translationsByLang[lang]?.isEmpty == false) }) {
            return true
        }
        // 无显式 xml:lang 标注的词源原生翻译（NCM tlyric / QQ / 酷狗 / 无 lang 的 TTML x-translation）默认对应简体中文 zh
        if lang == "zh" {
            return lines.contains(where: { $0.translationsByLang.isEmpty && ($0.translation?.isEmpty == false) })
        }
        return false
    }

    private static func nativeSlotTranslations(in lines: [MutableLine], for lang: String) -> [String?] {
        let hasKeyed = lines.contains(where: { $0.translationsByLang[lang]?.isEmpty == false })
        if hasKeyed {
            return lines.map { $0.translationsByLang[lang] }
        }
        if lang == "zh" {
            return lines.map { $0.translation }
        }
        return Array(repeating: nil, count: lines.count)
    }

    private static func resolveSlotTranslations(
        lines: [MutableLine],
        baseSource: String,
        slot: TranslationSelectionItem,
        dto: BackendTranslationsDTO?,
        sameLangComparison: Bool
    ) -> [String?] {
        let nativeAvail = hasNativeTranslation(in: lines, for: slot.lang)
        if slot.preferNative && nativeAvail {
            return nativeSlotTranslations(in: lines, for: slot.lang)
        }

        let aiOnlyMode = sameLangComparison && !slot.preferNative
        let validAI: [BackendTranslationLineDTO]? = {
            guard let dto,
                  !(dto.native ?? false),
                  dto.source == nil || dto.source?.isEmpty == true || dto.source == baseSource,
                  dto.target_lang == nil || dto.target_lang?.isEmpty == true || dto.target_lang == slot.lang,
                  let trLines = dto.lines,
                  trLines.contains(where: { !$0.translation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                return nil
            }
            return trLines
        }()

        guard let trLines = validAI else {
            // 若后端在 native=true 时直接通过 dto.lines 返回了原生译文，兜底按匹配填入；否则回退词源内置译文
            if !aiOnlyMode, let dto, dto.native == true, let dtoNativeLines = dto.lines, !dtoNativeLines.isEmpty {
                return matchTranslationDTO(lines: lines, dtoLines: dtoNativeLines, fallback: nativeSlotTranslations(in: lines, for: slot.lang))
            }
            return aiOnlyMode ? Array(repeating: nil, count: lines.count) : nativeSlotTranslations(in: lines, for: slot.lang)
        }

        let fallback = aiOnlyMode ? Array(repeating: nil, count: lines.count) : nativeSlotTranslations(in: lines, for: slot.lang)
        return matchTranslationDTO(lines: lines, dtoLines: trLines, fallback: fallback)
    }

    private static func matchTranslationDTO(
        lines: [MutableLine],
        dtoLines: [BackendTranslationLineDTO],
        fallback: [String?]
    ) -> [String?] {
        var lookup: [String: String] = [:]
        for item in dtoLines {
            let trimmed = item.translation.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let key = "\(item.bg ?? false):\(item.occurrence):\(normalizeMatchText(item.text))"
            lookup[key] = trimmed
        }
        var mainOcc: [String: Int] = [:]
        var bgOcc: [String: Int] = [:]
        return lines.indices.map { i in
            let norm = normalizeMatchText(lines[i].plainText)
            let bg = lines[i].isBackground
            let occ = bg ? bgOcc[norm, default: 0] : mainOcc[norm, default: 0]
            if bg { bgOcc[norm] = occ + 1 } else { mainOcc[norm] = occ + 1 }
            return lookup["\(bg):\(occ):\(norm)"] ?? fallback[i]
        }
    }

    private static func getData<T: Decodable>(url: URL?, timeout: TimeInterval = 8.0, reload: Bool = false) async -> T? {
        guard let url else { return nil }
        let policy: URLRequest.CachePolicy = reload ? .reloadIgnoringLocalCacheData : .returnCacheDataElseLoad
        var req = URLRequest(url: url, cachePolicy: policy, timeoutInterval: timeout)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            return nil
        }
        return (try? JSONDecoder().decode(APIEnvelope<T>.self, from: data))?.data
    }

    private static func cleanOrigin(_ raw: String) -> String {
        raw.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
    }

    private static func isLocalOrPrivateHost(_ host: String) -> Bool {
        let h = host.lowercased()
        if h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]" || h.hasSuffix(".local") || !h.contains(".") {
            return true
        }
        let octets = h.split(separator: ".").compactMap { Int($0) }
        if octets.count == 4 {
            if octets[0] == 10 || octets[0] == 127 { return true }
            if octets[0] == 192 && octets[1] == 168 { return true }
            if octets[0] == 172 && (16...31).contains(octets[1]) { return true }
            if octets[0] == 169 && octets[1] == 254 { return true }
            // 纯 IPv4 地址（无 TLS 证书的内网对象存储或自建 IP 站点）保留原始 http:// 协议，不强转 https://
            return true
        }
        return false
    }

    private static func resolveCoverURL(raw: String?, origin: String) -> String? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if raw.contains("music.126.net") {
            let httpsRaw = raw.hasPrefix("http://")
                ? "https://" + raw.dropFirst("http://".count)
                : raw
            let base = httpsRaw.split(separator: "?", maxSplits: 1).first.map(String.init) ?? httpsRaw
            return "\(base)?imageView=1&thumbnail=240y240&type=webp"
        }
        if raw.hasPrefix("http://") {
            if let parsed = URL(string: raw), let host = parsed.host, !isLocalOrPrivateHost(host) {
                return "https://" + raw.dropFirst("http://".count)
            }
            return raw
        }
        if raw.hasPrefix("https://") {
            return raw
        }
        if raw.hasPrefix("/") {
            return "\(origin)\(raw)"
        }
        return raw
    }

    private static func normalizeMatchText(_ text: String) -> String {
        text.precomposedStringWithCompatibilityMapping
            .lowercased()
            .unicodeScalars
            .filter { !CharacterSet.whitespacesAndNewlines.contains($0) && !CharacterSet.punctuationCharacters.contains($0) }
            .map(String.init)
            .joined()
    }
}
