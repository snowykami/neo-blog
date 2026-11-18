import Foundation

/// 独立播放模式逐字/逐音节音译对齐引擎：
/// 1:1 对齐 `web/src/lib/lyrics/romanization.ts`、`lyric-pronunciation.ts`、`ruby-layout.ts` 与 `desktop-island-bridge.tsx`
enum RomanizationAligner {
    struct TimedSpan: Equatable, Sendable {
        let text: String
        let start: Double
        let end: Double
    }

    private struct TokenChar {
        let raw: Character
        let folded: [Character]
    }

    private struct Token {
        let text: String
        let chars: [TokenChar]
        let letters: [Character]
    }

    private static let macrons: [Character: String] = [
        "ā": "aa", "â": "aa",
        "ī": "ii", "î": "ii",
        "ū": "uu", "û": "uu",
        "ē": "ee", "ê": "ee",
        "ō": "ou", "ô": "ou"
    ]

    private static let vowels: Set<Character> = ["a", "i", "u", "e", "o"]
    private static let vowelsOrN: Set<Character> = ["a", "i", "u", "e", "o", "n"]
    private static let smallKanaSet: Set<Character> = [
        "ゃ", "ゅ", "ょ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゎ",
        "ャ", "ュ", "ョ", "ァ", "ィ", "ゥ", "ェ", "ォ", "ヮ"
    ]
    private static let sokuonSet: Set<Character> = ["っ", "ッ"]
    private static let longMarkSet: Set<Character> = ["ー", "〜", "~"]

    private static let maxStrayLetters = 2
    private static let maxLettersPerHan = 8

    // MARK: - 出口净化（对齐 ruby-layout.ts rubyText + desktop-island-bridge.tsx L209-216）

    /// 剥离音译片段首尾空白、标点与符号（豁免台湾注音轻声点 `˙` U+02D9），过滤纯标点空段
    static func rubyText(_ raw: String) -> String {
        var scalars = Substring(raw).unicodeScalars
        while let first = scalars.first, isEdgeStrippableScalar(first) {
            scalars.removeFirst()
        }
        while let last = scalars.last, isEdgeStrippableScalar(last) {
            scalars.removeLast()
        }
        return String(scalars)
    }

    static func sanitizeForPayload(_ items: [LyricRomanWordPayload]) -> [LyricRomanWordPayload] {
        items.compactMap { rw in
            let cleaned = rubyText(rw.text)
            guard !cleaned.isEmpty else { return nil }
            return LyricRomanWordPayload(text: cleaned, start: rw.start, end: rw.end, word: rw.word)
        }
    }

    /// 为逐字歌词包中尚无 `romanizationWords` 的行补齐启发式逐音节对齐（用于离线缓存快照升级等场景）
    static func withRomanizationWords(_ bundle: LyricsBundlePayload) -> LyricsBundlePayload {
        guard bundle.wordSynced, !bundle.lines.isEmpty else { return bundle }
        var changed = false
        let updatedLines = bundle.lines.map { line -> LyricLinePayload in
            guard line.romanizationWords.isEmpty,
                  let roma = line.romanization,
                  !roma.isEmpty,
                  let aligned = alignRomanization(roma, words: line.words) else {
                return line
            }
            let sanitized = sanitizeForPayload(aligned)
            guard !sanitized.isEmpty else { return line }
            changed = true
            return LyricLinePayload(
                start: line.start,
                end: line.end,
                isDuet: line.isDuet,
                isBackground: line.isBackground,
                align: line.align,
                owner: line.owner,
                paragraphStart: line.paragraphStart,
                backgroundPosition: line.backgroundPosition,
                chorusStart: line.chorusStart,
                edgeColors: line.edgeColors,
                singerName: line.singerName,
                singerDotOnly: line.singerDotOnly,
                translation: line.translation,
                secondaryTranslation: line.secondaryTranslation,
                romanization: line.romanization,
                romanizationWords: sanitized,
                moodHex: line.moodHex,
                scene: line.scene,
                sceneColorHex: line.sceneColorHex,
                sceneLines: line.sceneLines,
                words: line.words,
                emphasis: line.emphasis
            )
        }
        guard changed else { return bundle }
        return LyricsBundlePayload(
            source: bundle.source,
            sourceName: bundle.sourceName,
            font: bundle.font,
            motion: bundle.motion,
            wordSynced: bundle.wordSynced,
            instrumental: bundle.instrumental,
            spotlights: bundle.spotlights,
            sprites: bundle.sprites,
            intro: bundle.intro,
            outro: bundle.outro,
            notes: bundle.notes,
            interludes: bundle.interludes,
            lines: updatedLines
        )
    }

    // MARK: - 四条核心对齐管线

    /// 1. 整行纯文本音译 -> 原文音节对齐（日文假名锚点+音拍均分 / 纯中文单字 1:1 配对；对不齐时宁缺勿错返回 nil）
    static func alignRomanization(_ romanization: String, words: [LyricWordPayload]) -> [LyricRomanWordPayload]? {
        let rawTokens = romanization
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .map(toToken)
        guard !words.isEmpty, rawTokens.contains(where: { !$0.letters.isEmpty }) else {
            return nil
        }
        if let paired = pairPerCharacter(tokens: rawTokens, words: words) {
            return paired
        }
        let joinedWords = words.map(\.text).joined()
        guard joinedWords.contains(where: isKanaCharacter) else {
            return nil
        }
        let letters = rawTokens.flatMap(\.letters)
        guard let owners = assignLetters(letters: letters, words: words) else {
            return nil
        }
        return build(tokens: rawTokens, ownerOfLetter: owners, words: words)
    }

    /// 2. 来源自带逐音节时间的音译（QQ 音乐 QRC / 酷狗 KRC）：按开始时间（+20ms 容差）归属到所在原文词元
    static func romanWordsFromTimed(_ items: [TimedSpan], words: [LyricWordPayload]) -> [LyricRomanWordPayload]? {
        let timed = items.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.end > $0.start }
        guard !timed.isEmpty, !words.isEmpty else { return nil }
        return timed.map { item in
            var wordIdx = 0
            var i = 0
            while i < words.count && words[i].start <= item.start + 20.0 {
                wordIdx = i
                i += 1
            }
            return LyricRomanWordPayload(text: item.text, start: item.start, end: item.end, word: wordIdx)
        }
    }

    /// 3. TTML 带时间的音译分段（`<transliteration>` / `<span ttm:role="x-roman">` 子 span）：多音拍按字母权重均分时长
    static func romanWordsFromSpans(_ spans: [TimedSpan], words: [LyricWordPayload]) -> [LyricRomanWordPayload]? {
        guard !spans.isEmpty, !words.isEmpty else { return nil }
        var result: [LyricRomanWordPayload] = []
        for span in spans {
            var wordIdx = 0
            var i = 0
            while i < words.count && words[i].start <= span.start + 20.0 {
                wordIdx = i
                i += 1
            }
            let morae = span.text
                .components(separatedBy: .whitespacesAndNewlines)
                .filter { !$0.isEmpty }
            guard !morae.isEmpty else { continue }
            let pieces = splitTime(texts: morae, wordIndex: wordIdx, start: span.start, end: span.end)
            result.append(contentsOf: pieces)
        }
        return result.isEmpty ? nil : result
    }

    /// 4. 后端 AI 注音 `tokens` 数组及回退对齐（1:1 对齐 `lyric-pronunciation.ts` `buildRomanWordsFromAiTokens`）
    static func buildRomanWordsFromAiTokens(
        words: [LyricWordPayload],
        tokens: [String]?,
        fallbackPronunciation: String?
    ) -> [LyricRomanWordPayload]? {
        guard !words.isEmpty else { return nil }
        let indices = extractPronounceableWordIndices(words)
        guard !indices.isEmpty else { return nil }

        if let tokens, tokens.count == indices.count {
            var pairs: [(wordIdx: Int, text: String)] = []
            for k in 0..<indices.count {
                let cleaned = tokens[k].trimmingCharacters(in: .whitespacesAndNewlines)
                if !cleaned.isEmpty {
                    pairs.append((indices[k], cleaned))
                }
            }
            if !pairs.isEmpty {
                return pairs.enumerated().map { idx, item in
                    let w = words[item.wordIdx]
                    let suffix = idx < pairs.count - 1 ? " " : ""
                    return LyricRomanWordPayload(
                        text: item.text + suffix,
                        start: w.start,
                        end: w.end,
                        word: item.wordIdx
                    )
                }
            }
        }

        guard let fallback = fallbackPronunciation?.trimmingCharacters(in: .whitespacesAndNewlines),
              !fallback.isEmpty else {
            return nil
        }

        let parts = fallback.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        if !parts.isEmpty {
            if parts.count == indices.count {
                return indices.enumerated().map { k, wordIdx in
                    let w = words[wordIdx]
                    let suffix = k < indices.count - 1 ? " " : ""
                    return LyricRomanWordPayload(
                        text: parts[k] + suffix,
                        start: w.start,
                        end: w.end,
                        word: wordIdx
                    )
                }
            }

            let allPureHan = indices.allSatisfy { idx in
                let t = words[idx].text.trimmingCharacters(in: .whitespacesAndNewlines)
                return !t.isEmpty && t.unicodeScalars.allSatisfy(isHanScalar)
            }
            if allPureHan {
                var totalHan = 0
                let hanCounts: [Int] = indices.map { idx in
                    let t = words[idx].text.trimmingCharacters(in: .whitespacesAndNewlines)
                    let c = t.unicodeScalars.filter(isHanScalar).count
                    totalHan += c
                    return c
                }
                if totalHan > 0 && totalHan == parts.count {
                    var spans: [TimedSpan] = []
                    var cursor = 0
                    for (i, wordIdx) in indices.enumerated() {
                        let w = words[wordIdx]
                        let count = hanCounts[i]
                        let duration = max(1.0, w.end - w.start)
                        for j in 0..<count {
                            let s = w.start + (duration * Double(j) / Double(count)).rounded()
                            let e = w.start + (duration * Double(j + 1) / Double(count)).rounded()
                            spans.append(TimedSpan(text: parts[cursor], start: s, end: max(s + 1.0, e)))
                            cursor += 1
                        }
                    }
                    if let aligned = romanWordsFromSpans(spans, words: words), !aligned.isEmpty {
                        return aligned.enumerated().map { idx, item in
                            let trimmed = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
                            let suffix = idx < aligned.count - 1 ? " " : ""
                            return LyricRomanWordPayload(
                                text: trimmed + suffix,
                                start: item.start,
                                end: item.end,
                                word: item.word
                            )
                        }
                    }
                }
            }
        }

        return alignRomanization(fallback, words: words)
    }

    static func extractPronounceableWordIndices(_ words: [LyricWordPayload]) -> [Int] {
        words.enumerated().compactMap { idx, w in
            hasPronounceableChar(w.text) ? idx : nil
        }
    }

    // MARK: - 内部字符折叠、假名罗马音转换与音拍分配

    private static func isEdgeStrippableScalar(_ u: UnicodeScalar) -> Bool {
        if u.value == 0x02D9 { return false } // 保留台湾注音轻声点 ˙
        if u.properties.isWhitespace { return true }
        switch u.properties.generalCategory {
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation,
             .initialPunctuation, .finalPunctuation, .otherPunctuation,
             .mathSymbol, .currencySymbol, .modifierSymbol, .otherSymbol,
             .spaceSeparator, .lineSeparator, .paragraphSeparator:
            return true
        default:
            return false
        }
    }

    private static func hasPronounceableChar(_ text: String) -> Bool {
        text.unicodeScalars.contains { u in
            switch u.properties.generalCategory {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
                 .decimalNumber, .letterNumber, .otherNumber:
                return true
            default:
                return false
            }
        }
    }

    static func isHanScalar(_ u: UnicodeScalar) -> Bool {
        // 叠字符 `々` (U+3005) 与 `〻` (U+303B) 在 JS /\p{Script=Han}/u 中为 true，但 Swift isIdeographic 为 false
        if u.value == 0x3005 || u.value == 0x303B { return true }
        // 排除片假名/平假名长音与叠字符（U+3040..30FF），其余表意汉字按 isIdeographic 判定
        if (0x3040...0x30FF).contains(u.value) { return false }
        return u.properties.isIdeographic
    }

    static func containsCJK(_ text: String) -> Bool {
        text.unicodeScalars.contains { u in
            isHanScalar(u)
                || isKanaScalar(u)
                || (0xAC00...0xD7AF).contains(u.value)
                || (0x1100...0x11FF).contains(u.value)
                || (0x3130...0x318F).contains(u.value)
        }
    }

    static func containsLatinLetter(_ text: String) -> Bool {
        text.unicodeScalars.contains { u in
            (0x0041...0x005A).contains(u.value)
                || (0x0061...0x007A).contains(u.value)
                || (0x00C0...0x024F).contains(u.value)
        }
    }

    private static func hasHan(_ text: String) -> Bool {
        text.unicodeScalars.contains(where: isHanScalar)
    }

    private static func isKanaScalar(_ u: UnicodeScalar) -> Bool {
        let v = u.value
        return (0x3041...0x3096).contains(v)
            || (0x3099...0x309F).contains(v)
            || (0x30A1...0x30FA).contains(v)
            || (0x30FC...0x30FF).contains(v)
            || (0xFF66...0xFF9F).contains(v)
    }

    private static func isKanaCharacter(_ ch: Character) -> Bool {
        ch.unicodeScalars.allSatisfy(isKanaScalar)
    }

    private static func isKanaString(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy(isKanaCharacter)
    }

    private static func foldChar(_ ch: Character) -> String {
        let lowerStr = ch.lowercased()
        if lowerStr.count == 1, let first = lowerStr.first, let mac = macrons[first] {
            return mac
        }
        let decomposed = lowerStr.decomposedStringWithCompatibilityMapping
        var out = ""
        for u in decomposed.unicodeScalars {
            let v = u.value
            if (0x61...0x7A).contains(v)
                || (0x30...0x39).contains(v)
                || (0x3100...0x312F).contains(v)
                || (0x31A0...0x31BF).contains(v) {
                out.unicodeScalars.append(u)
            }
        }
        return out
    }

    private static func fold(_ text: String) -> String {
        var out = ""
        for ch in text {
            out += foldChar(ch)
        }
        return out
    }

    private static func toToken(_ text: String) -> Token {
        var chars: [TokenChar] = []
        var letters: [Character] = []
        chars.reserveCapacity(text.count)
        for ch in text {
            let folded = Array(foldChar(ch))
            chars.append(TokenChar(raw: ch, folded: folded))
            letters.append(contentsOf: folded)
        }
        return Token(text: text, chars: chars, letters: letters)
    }

    private static func splitMorae(_ letters: [Character]) -> [[Character]] {
        var result: [[Character]] = []
        var current: [Character] = []
        for i in letters.indices {
            let letter = letters[i]
            let next: Character? = (i + 1 < letters.count) ? letters[i + 1] : nil
            current.append(letter)
            let isVowel = vowels.contains(letter)
            let isStandaloneN = letter == "n"
                && current.count == 1
                && (next == nil || (!vowels.contains(next!) && next! != "y"))
            let isGeminateConsonant = (next == letter) && !vowels.contains(letter)
            if isVowel || isStandaloneN || isGeminateConsonant {
                result.append(current)
                current.removeAll(keepingCapacity: true)
            }
        }
        if !current.isEmpty {
            result.append(current)
        }
        return result
    }

    private static func shareMorae(_ letters: [Character], count: Int) -> [[Character]]? {
        guard count > 0 else { return nil }
        var morae: [[Character]] = []
        for mora in splitMorae(letters) {
            if !morae.isEmpty && mora.count == 1 && !vowelsOrN.contains(mora[0]) {
                morae[morae.count - 1].append(contentsOf: mora)
            } else {
                morae.append(mora)
            }
        }
        guard morae.count >= count else { return nil }
        var result: [[Character]] = []
        var index = 0
        for k in 0..<count {
            let remaining = morae.count - index
            let slots = count - k
            let take = (remaining + slots - 1) / slots
            let flat = Array(morae[index..<(index + take)].joined())
            result.append(flat)
            index += take
        }
        return result
    }

    private static func syllableReadings(_ words: [LyricWordPayload]) -> [String?] {
        let texts = words.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
        var readings: [String?] = texts.map { text in
            if text.isEmpty || (text.count == 1 && (sokuonSet.contains(text.first!) || longMarkSet.contains(text.first!))) {
                return ""
            }
            if hasHan(text) {
                return nil
            }
            if text.contains(where: isKanaCharacter) {
                return fold(kanaToRomaji(text))
            }
            return fold(text)
        }
        for i in texts.indices where i > 0 {
            let text = texts[i]
            if text.count == 1, let ch = text.first, smallKanaSet.contains(ch), isKanaString(texts[i - 1]) {
                readings[i - 1] = fold(kanaToRomaji(texts[i - 1] + text))
                readings[i] = ""
            }
        }
        return readings
    }

    private static func readingVariants(reading: String, text: String) -> [String] {
        var variants: Set<String> = [reading]
        if text == "は" { variants.insert("wa") }
        if text == "へ" { variants.insert("e") }
        if text == "を" { variants.insert("o") }
        for v in Array(variants) {
            if v.contains("cch") {
                variants.insert(v.replacingOccurrences(of: "cch", with: "tch"))
            }
            if v.contains("oo") {
                variants.insert(v.replacingOccurrences(of: "oo", with: "ou"))
            }
        }
        for v in Array(variants) {
            variants.insert(
                v.replacingOccurrences(of: "du", with: "zu")
                    .replacingOccurrences(of: "di", with: "ji")
            )
            variants.insert(
                v.replacingOccurrences(of: "ou", with: "o")
                    .replacingOccurrences(of: "uu", with: "u")
                    .replacingOccurrences(of: "oo", with: "o")
                    .replacingOccurrences(of: "ii", with: "i")
                    .replacingOccurrences(of: "ee", with: "e")
                    .replacingOccurrences(of: "aa", with: "a")
            )
        }
        return variants.filter { !$0.isEmpty }.sorted { $0.count > $1.count }
    }

    private static func matchesAt(_ letters: [Character], at: Int, candidate: [Character]) -> Bool {
        guard at + candidate.count <= letters.count else { return false }
        for i in 0..<candidate.count {
            if letters[at + i] != candidate[i] {
                return false
            }
        }
        return true
    }

    private static func assignLetters(letters: [Character], words: [LyricWordPayload]) -> [Int]? {
        let readings = syllableReadings(words)
        var owner = Array(repeating: -1, count: letters.count)
        var pointer = 0
        var pending: [Int] = []
        var lastOwner = -1

        func distribute(from: Int, to: Int) -> Bool {
            if from >= to {
                return pending.isEmpty
            }
            if pending.isEmpty {
                for i in from..<to {
                    owner[i] = lastOwner
                }
                return true
            }
            let slice = Array(letters[from..<to])
            guard let shares = shareMorae(slice, count: pending.count) else {
                return false
            }
            var at = from
            for (k, share) in shares.enumerated() {
                for i in 0..<share.count {
                    owner[at + i] = pending[k]
                }
                at += share.count
            }
            lastOwner = pending[pending.count - 1]
            pending.removeAll(keepingCapacity: true)
            return true
        }

        for s in words.indices {
            guard let reading = readings[s] else {
                pending.append(s)
                continue
            }
            if reading.isEmpty {
                continue
            }
            let maxGap = !pending.isEmpty ? pending.count * maxLettersPerHan : maxStrayLetters
            guard pointer < letters.count else { return nil }
            let upper = min(letters.count - 1, pointer + maxGap)
            guard pointer <= upper else { return nil }

            let candidates = readingVariants(
                reading: reading,
                text: words[s].text.trimmingCharacters(in: .whitespacesAndNewlines)
            ).map { Array($0) }

            var found: (at: Int, length: Int)? = nil
            for at in pointer...upper {
                if let hit = candidates.first(where: { matchesAt(letters, at: at, candidate: $0) }) {
                    found = (at, hit.count)
                    break
                }
            }
            guard let found, distribute(from: pointer, to: found.at) else {
                return nil
            }
            for i in found.at..<(found.at + found.length) {
                owner[i] = s
            }
            lastOwner = s
            pointer = found.at + found.length
        }

        guard distribute(from: pointer, to: letters.count),
              let firstValid = owner.first(where: { $0 >= 0 }) else {
            return nil
        }
        return owner.map { $0 >= 0 ? $0 : firstValid }
    }

    private static func letterWeight(_ text: String) -> Int {
        max(1, fold(text).count)
    }

    private static func splitTime(
        texts: [String],
        wordIndex: Int,
        start: Double,
        end: Double
    ) -> [LyricRomanWordPayload] {
        let total = texts.reduce(0) { $0 + letterWeight($1) }
        var at = start
        var used = 0
        return texts.map { text in
            used += letterWeight(text)
            let next = start + ((end - start) * Double(used) / Double(total)).rounded()
            let piece = LyricRomanWordPayload(text: text, start: at, end: next, word: wordIndex)
            at = next
            return piece
        }
    }

    private static func build(
        tokens: [Token],
        ownerOfLetter: [Int],
        words: [LyricWordPayload]
    ) -> [LyricRomanWordPayload] {
        var rawParts: [LyricRomanWordPayload] = []
        var letterCursor = 0

        for (tIdx, token) in tokens.enumerated() {
            if token.letters.isEmpty {
                if !rawParts.isEmpty {
                    let last = rawParts[rawParts.count - 1]
                    rawParts[rawParts.count - 1] = LyricRomanWordPayload(
                        text: "\(last.text) \(token.text)",
                        start: last.start,
                        end: last.end,
                        word: last.word
                    )
                }
                continue
            }

            var runs: [(word: Int, text: String)] = []
            var leadingNonLetters = ""

            func appendToRun(owner: Int, piece: String) {
                if let last = runs.last, last.word == owner {
                    runs[runs.count - 1].text += piece
                } else {
                    runs.append((owner, leadingNonLetters + piece))
                    leadingNonLetters = ""
                }
            }

            for tc in token.chars {
                if tc.folded.isEmpty {
                    if !runs.isEmpty {
                        runs[runs.count - 1].text.append(tc.raw)
                    } else {
                        leadingNonLetters.append(tc.raw)
                    }
                    continue
                }
                let charOwners = (0..<tc.folded.count).map { ownerOfLetter[letterCursor + $0] }
                letterCursor += tc.folded.count
                let firstOwner = charOwners[0]
                if charOwners.allSatisfy({ $0 == firstOwner }) {
                    // 同一字符展开的全部音素归属同一个词元时保留原字符（保留声调或长音符号如 gù / rū）
                    appendToRun(owner: firstOwner, piece: String(tc.raw))
                } else {
                    // 宏长音字符（如 ō -> ou）内部跨词元切分时，按展开后的单字母分别归入各自词元（如 思う + omō -> omo + u）
                    for (li, letter) in tc.folded.enumerated() {
                        appendToRun(owner: charOwners[li], piece: String(letter))
                    }
                }
            }

            if tIdx < tokens.count - 1, !runs.isEmpty {
                runs[runs.count - 1].text += " "
            }
            for run in runs {
                let w = words[run.word]
                rawParts.append(LyricRomanWordPayload(text: run.text, start: w.start, end: w.end, word: run.word))
            }
        }

        var output: [LyricRomanWordPayload] = []
        for (wIdx, word) in words.enumerated() {
            let parts = rawParts.filter { $0.word == wIdx }
            if parts.count > 1 {
                output.append(contentsOf: splitTime(texts: parts.map(\.text), wordIndex: wIdx, start: word.start, end: word.end))
            } else {
                output.append(contentsOf: parts)
            }
        }
        return output
    }

    private static func pairPerCharacter(
        tokens: [Token],
        words: [LyricWordPayload]
    ) -> [LyricRomanWordPayload]? {
        let joined = words.map(\.text).joined()
        if joined.contains(where: isKanaCharacter) || !hasHan(joined) {
            return nil
        }
        let contentIndices = words.enumerated().compactMap { idx, w -> Int? in
            (!fold(w.text).isEmpty || hasHan(w.text)) ? idx : nil
        }
        let lettered = tokens.filter { !$0.letters.isEmpty }
        guard contentIndices.count == lettered.count else { return nil }
        let validLengths = contentIndices.allSatisfy { idx in
            let trimmed = words[idx].text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.count == 1 || !hasHan(words[idx].text)
        }
        guard validLengths else { return nil }
        return contentIndices.enumerated().map { k, wIdx in
            let w = words[wIdx]
            let suffix = k < contentIndices.count - 1 ? " " : ""
            return LyricRomanWordPayload(
                text: lettered[k].text + suffix,
                start: w.start,
                end: w.end,
                word: wIdx
            )
        }
    }

    // MARK: - 确定性平/片假名 -> Wanakana 兼容罗马音表

    private static let kanaDigraphs: [String: String] = [
        "きゃ": "kya", "きぃ": "kyi", "きゅ": "kyu", "きぇ": "kye", "きょ": "kyo",
        "ぎゃ": "gya", "ぎぃ": "gyi", "ぎゅ": "gyu", "ぎぇ": "gye", "ぎょ": "gyo",
        "しゃ": "sha", "しぃ": "syi", "しゅ": "shu", "しぇ": "she", "しょ": "sho",
        "じゃ": "ja",  "じぃ": "jyi", "じゅ": "ju",  "じぇ": "je",  "じょ": "jo",
        "ちゃ": "cha", "ちぃ": "cyi", "ちゅ": "chu", "ちぇ": "che", "ちょ": "cho",
        "ぢゃ": "dya", "ぢぃ": "dyi", "ぢゅ": "dyu", "ぢぇ": "dye", "ぢょ": "dyo",
        "にゃ": "nya", "にぃ": "nyi", "にゅ": "nyu", "にぇ": "nye", "にょ": "nyo",
        "ひゃ": "hya", "ひぃ": "hyi", "ひゅ": "hyu", "ひぇ": "hye", "ひょ": "hyo",
        "びゃ": "bya", "びぃ": "byi", "びゅ": "byu", "びぇ": "bye", "びょ": "byo",
        "ぴゃ": "pya", "ぴぃ": "pyi", "ぴゅ": "pyu", "ぴぇ": "pye", "ぴょ": "pyo",
        "みゃ": "mya", "みぃ": "myi", "みゅ": "myu", "みぇ": "mye", "みょ": "myo",
        "りゃ": "rya", "りぃ": "ryi", "りゅ": "ryu", "りぇ": "rye", "りょ": "ryo",
        "ふぁ": "fa",  "ふぃ": "fi",  "ふぅ": "fu",  "ふぇ": "fe",  "ふぉ": "fo",
        "ふゃ": "fya", "ふゅ": "fyu", "ふょ": "fyo",
        "うぁ": "wha", "うぃ": "wi",  "うぇ": "we",  "うぉ": "wo",
        "ゔぁ": "va",  "ゔぃ": "vi",  "ゔぇ": "ve",  "ゔぉ": "vo",  "ゔゅ": "vyu",
        "てぃ": "ti",  "てゅ": "tyu", "でぃ": "di",  "でゅ": "dyu",
        "とぅ": "tu",  "どぅ": "du",
        "つぁ": "tsa", "つぃ": "tsi", "つぇ": "tse", "つぉ": "tso",
        "くぁ": "kwa", "くぃ": "kwi", "くぇ": "kwe", "くぉ": "kwo",
        "ぐぁ": "gwa", "ぐぃ": "gwi", "ぐぇ": "gwe", "ぐぉ": "gwo"
    ]

    private static let kanaMonographs: [Character: String] = [
        "あ": "a",  "い": "i",   "う": "u",   "え": "e",  "お": "o",
        "か": "ka", "き": "ki",  "く": "ku",  "け": "ke", "こ": "ko",
        "さ": "sa", "し": "shi", "す": "su",  "せ": "se", "そ": "so",
        "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
        "な": "na", "に": "ni",  "ぬ": "nu",  "ね": "ne", "の": "no",
        "は": "ha", "ひ": "hi",  "ふ": "fu",  "へ": "he", "ほ": "ho",
        "ま": "ma", "み": "mi",  "む": "mu",  "め": "me", "も": "mo",
        "や": "ya", "ゆ": "yu",  "よ": "yo",
        "ら": "ra", "り": "ri",  "る": "ru",  "れ": "re", "ろ": "ro",
        "わ": "wa", "ゐ": "wi",  "ゑ": "we",  "を": "wo", "ん": "n",
        "が": "ga", "ぎ": "gi",  "ぐ": "gu",  "げ": "ge", "ご": "go",
        "ざ": "za", "じ": "ji",  "ず": "zu",  "ぜ": "ze", "ぞ": "zo",
        "だ": "da", "ぢ": "di",  "づ": "du",  "で": "de", "ど": "do",
        "ば": "ba", "び": "bi",  "ぶ": "bu",  "べ": "be", "ぼ": "bo",
        "ぱ": "pa", "ぴ": "pi",  "ぷ": "pu",  "ぺ": "pe", "ぽ": "po",
        "ゔ": "vu",
        "ぁ": "a",  "ぃ": "i",   "ぅ": "u",   "ぇ": "e",  "ぉ": "o",
        "ゃ": "ya", "ゅ": "yu",  "ょ": "yo",  "ゎ": "wa", "ゕ": "ka", "ゖ": "ke"
    ]

    /// 将平假名/片假名（含半角片假名、浊音组合、拗音、促音 `っ`、长音 `ー`）确定性转为与 `wanakana.toRomaji` 一致的罗马音
    static func kanaToRomaji(_ input: String) -> String {
        // 先经 NFKC + NFC 将半角片假名（ｶﾞ -> ガ）与分解浊点（か+゙ -> が）归一，再把片假名平移到平假名码位
        let normalized = input.decomposedStringWithCompatibilityMapping.precomposedStringWithCanonicalMapping
        var hiraChars: [Character] = []
        hiraChars.reserveCapacity(normalized.count)
        for ch in normalized {
            if ch.unicodeScalars.count == 1, let u = ch.unicodeScalars.first {
                if (0x30A1...0x30F6).contains(u.value), let mapped = UnicodeScalar(u.value - 0x60) {
                    hiraChars.append(Character(mapped))
                    continue
                }
            }
            hiraChars.append(ch)
        }

        var out = ""
        var i = 0
        var pendingSokuon = false

        while i < hiraChars.count {
            let ch = hiraChars[i]
            if ch == "っ" {
                pendingSokuon = true
                i += 1
                continue
            }
            if ch == "ー" {
                if let last = out.last, vowels.contains(last) {
                    out.append(last)
                }
                pendingSokuon = false
                i += 1
                continue
            }

            var syllableRomaji: String? = nil
            var consumed = 1
            if i + 1 < hiraChars.count {
                let pair = String([ch, hiraChars[i + 1]])
                if let dig = kanaDigraphs[pair] {
                    syllableRomaji = dig
                    consumed = 2
                }
            }
            if syllableRomaji == nil {
                syllableRomaji = kanaMonographs[ch]
            }

            if let roma = syllableRomaji {
                if pendingSokuon, let first = roma.first, !vowels.contains(first), first != "n" {
                    out.append(first)
                }
                pendingSokuon = false
                out += roma
            } else {
                pendingSokuon = false
                out.append(ch)
            }
            i += consumed
        }
        return out
    }

    // MARK: - 逐行读音语种识别与同语言自动隐藏（1:1 对齐 web/src/lib/lyrics/lyric-pronunciation.ts）

    private static let cantoneseParticles: Set<Character> = Set("嘅咗喺冇係唔啲嚟咁乜咩仲畀揾搵睇佢哋")
    private static let hokkienSingleChars: Set<Character> = Set("袂毋𨑨迌佇囥")
    private static let hokkienPhrases: [String] = ["啥物", "歹势", "歹勢", "仝款", "按怎", "家己", "佗位", "叨位"]
    private static let simpDistinctChars: Set<Character> = Set("们这为说时来对会着过还让给从没进动发开见经现样点听风爱觉梦泪岁声词乐车长门问间里后无东难写读语话谁请问谢认识学写书画电脑机车飞关总结实际应当应该变变化处总体万与业丛严丧个丰临丽举义乔习乡买乱干亏云亚产亲亿仅仆仍仓仪优价储儿党兰兴养兽内册军农冠冲决况冻净准凉减几凤凭凯出击刘则刚创删别刮到制刷券刺刻剂")
    private static let tradDistinctChars: Set<Character> = Set("們這為說時來對會著過還讓給從沒進動發開見經現樣點聽風愛覺夢淚歲聲詞樂車長門問間裡後無東難寫讀語話誰請問謝認識學書畫電腦機車飛關總結實際應當應該變變化處總體萬與業叢嚴喪個豐臨麗舉義喬習鄉買亂乾虧雲亞產親億僅僕仍倉儀優價儲兒黨蘭興養獸內冊軍農冠沖決況凍淨準涼減幾鳳憑凱出擊劉則剛創刪別刮到制刷券刺刻劑")
    private static let englishFunctionWords: Set<String> = [
        "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
        "my", "your", "his", "its", "our", "their", "am", "is", "are", "was", "were",
        "be", "been", "do", "does", "did", "have", "has", "had", "can", "could", "will",
        "would", "shall", "should", "may", "might", "must", "a", "an", "the", "and", "or",
        "but", "if", "so", "no", "not", "yes", "in", "on", "at", "to", "for", "of", "from",
        "by", "with", "as", "up", "out", "off", "down", "all", "go", "come", "see", "say",
        "let", "get", "got", "put", "run", "love", "like", "know", "want", "need", "feel",
        "make", "take", "time", "day", "way", "now", "here", "one", "two", "why", "who",
        "how", "what", "when", "where", "this", "that", "im", "dont", "away", "never",
        "just", "into", "through", "under", "over", "after", "before", "again", "still",
        "back", "more", "only", "ever", "every", "there", "about", "around", "without"
    ]
    private static let jyutpingRegex = try? NSRegularExpression(pattern: #"\b[a-z]{1,6}[1-6]\b"#)

    private static func containsBopomofo(_ s: String) -> Bool {
        s.unicodeScalars.contains { (0x3100...0x312F).contains($0.value) || (0x31A0...0x31BF).contains($0.value) }
    }

    private static func containsJyutping(_ s: String) -> Bool {
        let lower = s.lowercased()
        guard let re = jyutpingRegex else { return false }
        return re.firstMatch(in: lower, range: NSRange(lower.startIndex..., in: lower)) != nil
    }

    private static func containsCantoneseParticle(_ s: String) -> Bool {
        s.contains { cantoneseParticles.contains($0) }
    }

    private static func containsHokkienMarker(_ s: String) -> Bool {
        if s.contains(where: { hokkienSingleChars.contains($0) }) { return true }
        return hokkienPhrases.contains { s.contains($0) }
    }

    static func normalizePronunciationLangTag(_ raw: String?) -> String? {
        guard let cleaned = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-")
            .lowercased(),
              !cleaned.isEmpty,
              !cleaned.contains("-latn") else {
            return nil
        }
        if cleaned == "other" { return "other" }
        if cleaned == "zh-hk" || cleaned == "zh-mo" || cleaned.hasPrefix("zh-hk-") || cleaned.hasPrefix("zh-mo-") || cleaned.hasSuffix("-hk") || cleaned.hasSuffix("-mo") {
            return "zh-hk"
        }
        if cleaned == "zh-tw" || cleaned.hasPrefix("zh-tw-") || cleaned.hasSuffix("-tw") || cleaned.contains("hant") {
            return "zh-tw"
        }
        if cleaned == "zh" || cleaned.hasPrefix("zh-") { return "zh" }
        if cleaned == "en" || cleaned.hasPrefix("en-") { return "en" }
        if cleaned == "ja" || cleaned.hasPrefix("ja-") || cleaned == "jp" { return "ja" }
        if cleaned == "ko" || cleaned.hasPrefix("ko-") || cleaned == "kr" { return "ko" }
        let head = cleaned.split(separator: "-").first ?? ""
        return (2...3).contains(head.count) ? "other" : nil
    }

    private static func detectLatinLang(_ words: [String]) -> String {
        guard !words.isEmpty else { return "other" }
        var hits = Set<String>()
        var hitTokens = 0
        var strongHits = 0
        for w in words where englishFunctionWords.contains(w) {
            hits.insert(w)
            hitTokens += 1
            if w.count >= 3 || w == "im" { strongHits += 1 }
        }
        if words.count <= 6 {
            if strongHits >= 1 && hitTokens * 4 >= words.count { return "en" }
            if hits.count >= 2 && hitTokens * 5 >= words.count * 3 { return "en" }
            return "other"
        }
        if hits.count >= 2 && strongHits >= 1 && hitTokens * 100 >= words.count * 12 {
            return "en"
        }
        return "other"
    }

    private static func detectTextsLang(_ texts: [String], explicitTag: String? = nil) -> String? {
        let normTag = normalizePronunciationLangTag(explicitTag)
        var han = 0, kana = 0, hang = 0, latin = 0, other = 0, trad = 0, simp = 0
        var latinWords: [String] = []
        var curWord = ""

        func flushWord() {
            if !curWord.isEmpty {
                latinWords.append(curWord)
                curWord.removeAll(keepingCapacity: true)
            }
        }

        for text in texts {
            for ch in text {
                if isKanaCharacter(ch) {
                    flushWord()
                    kana += 1
                } else if ch.unicodeScalars.contains(where: { (0xAC00...0xD7AF).contains($0.value) || (0x1100...0x11FF).contains($0.value) || (0x3130...0x318F).contains($0.value) }) {
                    flushWord()
                    hang += 1
                } else if ch.unicodeScalars.contains(where: isHanScalar) {
                    flushWord()
                    han += 1
                    if tradDistinctChars.contains(ch) { trad += 1 }
                    if simpDistinctChars.contains(ch) { simp += 1 }
                } else if ch.unicodeScalars.allSatisfy({ (0x41...0x5A).contains($0.value) || (0x61...0x7A).contains($0.value) || (0xC0...0x24F).contains($0.value) }) {
                    latin += 1
                    curWord += ch.lowercased()
                } else if ch == "'" || ch == "’" {
                    continue
                } else if ch.isLetter {
                    flushWord()
                    other += 1
                } else {
                    flushWord()
                }
            }
            flushWord()
        }

        let total = han + kana + hang + latin + other
        if total == 0 { return normTag }
        let cjk = han + kana + hang

        // 1:1 对齐 web/src/lib/lyrics/lyric-language.ts L312-347：先用实际字形交叉校验显式标签
        switch normTag {
        case "ja":
            if kana > 0 || (han > 0 && han <= 4 && hang == 0 && latin == 0 && other == 0 && simp == 0) {
                return "ja"
            }
        case "ko":
            if hang > 0 { return "ko" }
        case "en":
            if latin > 0 && (cjk == 0 || latin > cjk * 2) { return "en" }
        case "other":
            if (other > 0 || latin > 0) && cjk == 0 { return "other" }
        case "zh-tw", "zh-hk":
            if kana == 0 && hang == 0 && han > 0 {
                if simp >= 2 && simp > trad * 2 { return "zh" }
                return normTag
            }
        case "zh":
            if kana == 0 && hang == 0 {
                if han == 0 && latin > other { return detectLatinLang(latinWords) }
                if trad >= 2 && trad > simp * 2 { return "zh-tw" }
                if han > 0 { return "zh" }
            }
        default:
            break
        }

        if kana >= 1 && (texts.count == 1 || Double(kana) >= Double(max(cjk, 1)) * 0.05) {
            return "ja"
        }
        if hang >= 1 && (texts.count == 1 || Double(hang) >= Double(total) * 0.1) {
            return "ko"
        }
        if han > 0 && (latin == 0 || Double(han) >= Double(latin) * 0.15) {
            if trad >= 2 && trad > simp * 2 { return "zh-tw" }
            return "zh"
        }
        if latin >= other && latin > 0 {
            return detectLatinLang(latinWords)
        }
        if other > 0 { return "other" }
        return normTag
    }

    static func detectSongPronunciationLang(
        texts: [String],
        nativeRomanizations: [String] = [],
        aiSongLang: String?
    ) -> String? {
        if let aiLang = aiSongLang, !aiLang.isEmpty {
            return aiLang == "other" ? "other" : (normalizePronunciationLangTag(aiLang) ?? aiLang)
        }
        var detected = detectTextsLang(texts)
        if detected == "zh" || detected == "zh-tw" {
            if texts.contains(where: containsCantoneseParticle) {
                detected = "zh-hk"
            } else if texts.contains(where: containsHokkienMarker) {
                detected = "other"
            }
        }
        let nativeJyutpingCount = nativeRomanizations.reduce(0) { $0 + (containsJyutping($1) ? 1 : 0) }
        if nativeJyutpingCount >= 2 && (detected == "zh" || detected == "zh-tw" || detected == "zh-hk" || (detected == nil && texts.contains(where: hasHan))) {
            return "zh-hk"
        }
        return detected
    }

    static func detectLinePronunciationLang(text: String, pron: String?, songLang: String?) -> String {
        let rom = pron?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !rom.isEmpty && containsBopomofo(rom) { return "zh-tw" }
        if !rom.isEmpty && containsJyutping(rom) { return "zh-hk" }
        if containsCantoneseParticle(text) { return "zh-hk" }
        if containsHokkienMarker(text) { return "other" }
        if let detected = detectTextsLang([text], explicitTag: songLang) {
            return detected
        }
        if songLang == "other" { return "other" }
        return normalizePronunciationLangTag(songLang) ?? "other"
    }

    static func shouldHideSameLangPronunciation(lineLang: String?, targetLang: String) -> Bool {
        guard let lineLang, !lineLang.isEmpty, lineLang != "other" else { return false }
        let norm: String? = (lineLang == "zh-tw" || lineLang == "zh-hk")
            ? lineLang
            : normalizePronunciationLangTag(lineLang)
        guard let norm, norm != "other", norm != "ja", norm != "ko" else { return false }
        let normTarget = (targetLang == "zh-tw" || targetLang == "zh-hk")
            ? targetLang
            : (normalizePronunciationLangTag(targetLang) ?? targetLang)
        if normTarget == "zh" || normTarget == "zh-tw" {
            return norm == "zh" || norm == "zh-tw"
        }
        if normTarget == "zh-hk" {
            return norm == "zh-hk"
        }
        if normTarget == "en" {
            return norm == "en"
        }
        return false
    }
}
