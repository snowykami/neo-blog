import Foundation

/// 纯函数式歌词舞台与时间轴求解器（零副作用、零 @Observable 状态耦合，1:1 对齐前端 timeline.ts / strip-slots.ts / moments.ts / music-page-controls.tsx）
enum StageTimelineEngine {
    /// 预构建展开面板的跨曲目稳定唯一 ID 歌词行与完整舞台条目（含前置/后置背景人声、≥7s 间奏三圆点及底栏词源标签）
    @MainActor
    static func buildStageArtifacts(
        from nextLyrics: LyricsBundlePayload,
        trackId: Int?
    ) -> (indexedLines: [IndexedLyricLine], stageEntries: [StageTimelineEntry]) {
        let tid = trackId ?? 0
        let builtLines: [IndexedLyricLine] = nextLyrics.lines.enumerated().map { idx, line in
            let dots = (line.edgeColors ?? []).prefix(6).enumerated().map { dotIdx, hex in
                SingerColorDot(id: "\(tid)-\(idx)-d\(dotIdx)", hex: hex)
            }
            return IndexedLyricLine(
                id: "\(tid)-\(idx)",
                index: idx,
                line: line,
                singerDots: dots
            )
        }

        var entries: [StageTimelineEntry] = []
        let sortedInterludes = nextLyrics.interludes.sorted { $0.start < $1.start }
        var interCursor = 0

        func nextMainAlign(fromLineIndex startIdx: Int) -> String {
            for j in max(0, startIdx)..<nextLyrics.lines.count where !nextLyrics.lines[j].isBackground {
                return nextLyrics.lines[j].align
            }
            return "left"
        }

        for item in builtLines {
            while interCursor < sortedInterludes.count && sortedInterludes[interCursor].end <= item.line.start + 1.0 {
                let inter = sortedInterludes[interCursor]
                entries.append(
                    .interlude(
                        id: "\(tid)-inter-\(interCursor)",
                        range: inter,
                        align: nextMainAlign(fromLineIndex: item.index)
                    )
                )
                interCursor += 1
            }
            entries.append(.line(item))
        }
        while interCursor < sortedInterludes.count {
            let inter = sortedInterludes[interCursor]
            entries.append(
                .interlude(
                    id: "\(tid)-inter-\(interCursor)",
                    range: inter,
                    align: "left"
                )
            )
            interCursor += 1
        }
        if !builtLines.isEmpty, let footer = nextLyrics.footerLabel, !footer.isEmpty {
            entries.append(.footer(id: "\(tid)-footer", text: footer))
        }
        return (builtLines, entries)
    }

    static func activeInterlude(in lyrics: LyricsBundlePayload, at ms: Double) -> TimeIntervalRange? {
        lyrics.interludes.first { ms >= $0.start && ms < $0.end }
    }

    /// 1:1 对齐 web/src/lib/lyrics/moments.ts lyricMomentAt：计算前奏导语、关键节点旁白/热评或尾奏热评
    static func activeMoment(
        lyrics: LyricsBundlePayload,
        effectiveDurationMs: Double,
        showMoments: Bool,
        at ms: Double
    ) -> IslandStore.ResolvedMoment? {
        guard showMoments else { return nil }
        let mainLines = lyrics.lines.filter { !$0.isBackground }
        guard !mainLines.isEmpty else { return nil }

        let introStartMs = 300.0
        let introLeadMs = 600.0
        let introMinMs = 8000.0
        let noteMs = 9000.0
        let outroDelayMs = 800.0
        let outroEndMs = 300.0

        let outroStart = (mainLines.map(\.end).max() ?? 0) + outroDelayMs
        let notes = lyrics.notes
        if !notes.isEmpty {
            for i in stride(from: notes.count - 1, through: 0, by: -1) {
                let start = notes[i].start
                let nextNoteStart = (i + 1 < notes.count) ? notes[i + 1].start : .infinity
                let outroCap = lyrics.outro != nil ? outroStart : .infinity
                let end = min(start + noteMs, min(nextNoteStart, outroCap))
                if ms >= start && ms < end {
                    let note = notes[i]
                    if note.source == "comment" {
                        return IslandStore.ResolvedMoment(kind: .comment(liked: note.liked ?? 0), text: note.content)
                    }
                    return IslandStore.ResolvedMoment(kind: .narration, text: note.content)
                }
            }
        }

        if let intro = lyrics.intro, !intro.isEmpty,
           ms >= introStartMs,
           ms < max(mainLines[0].start - introLeadMs, introStartMs + introMinMs) {
            return IslandStore.ResolvedMoment(kind: .narration, text: intro)
        }

        if let outro = lyrics.outro, !outro.content.isEmpty,
           ms > outroStart,
           (effectiveDurationMs <= 0 || ms < effectiveDurationMs - outroEndMs) {
            return IslandStore.ResolvedMoment(kind: .comment(liked: outro.liked), text: outro.content)
        }

        return nil
    }

    /// 返回当前活跃行下标集合与焦点主唱行下标（对齐 timeline.ts getTimelineState）
    static func timelineState(
        lyrics: LyricsBundlePayload,
        at ms: Double
    ) -> (active: [Int], focus: Int?, interlude: TimeIntervalRange?) {
        let lines = lyrics.lines
        guard !lines.isEmpty else { return ([], nil, nil) }

        if let inter = activeInterlude(in: lyrics, at: ms) {
            let anySinging = lines.contains { ms >= $0.start && ms < $0.end }
            if !anySinging {
                return ([], nil, inter)
            }
        }

        let earliest = lines.map(\.start).min() ?? 0
        let firstMain = lines.firstIndex(where: { !$0.isBackground }) ?? 0
        if ms < earliest {
            return ([], firstMain, nil)
        }

        var directActive: [Int] = []
        for (i, line) in lines.enumerated() where ms >= line.start && ms < line.end {
            directActive.append(i)
        }

        if !directActive.isEmpty {
            var activeSet = Set(directActive)
            for idx in directActive where lines[idx].isBackground {
                let owner = lines[idx].owner
                if owner >= 0 && owner < lines.count {
                    activeSet.insert(owner)
                }
            }
            let active = activeSet.sorted()
            let firstMainActive = directActive.first(where: { !lines[$0].isBackground })
            let ownerFallback = lines[directActive[0]].owner
            let focus = firstMainActive ?? (ownerFallback >= 0 ? ownerFallback : active[0])
            return (active, focus, nil)
        }

        var lastPassedMain: Int? = nil
        for (i, line) in lines.enumerated() where !line.isBackground {
            if line.start <= ms {
                lastPassedMain = i
            } else {
                break
            }
        }
        let allEnded = lines.allSatisfy { ms >= $0.end }
        if allEnded {
            return ([], nil, nil)
        }
        if let prev = lastPassedMain {
            return ([prev], prev, nil)
        }
        return ([], firstMain, nil)
    }

    /// 计算紧凑胶囊单行条此刻应显示的 1～4 句及其槽位（对齐 strip-slots.ts placeStripLines）
    static func stripRenderItems(
        lyrics: LyricsBundlePayload,
        trackId: Int,
        at ms: Double
    ) -> (items: [IslandStore.StripRenderItem], interlude: TimeIntervalRange?) {
        let state = timelineState(lyrics: lyrics, at: ms)
        if let inter = state.interlude {
            return ([], inter)
        }
        guard let focusIdx = state.focus, lyrics.lines.indices.contains(focusIdx) else {
            return ([], nil)
        }

        let lines = lyrics.lines
        let nextStartFor = { (idx: Int) -> Double? in
            for j in (idx + 1)..<lines.count where !lines[j].isBackground {
                return lines[j].start
            }
            return nil
        }

        let makeCandidate = { (idx: Int) -> StripCandidateLine in
            let l = lines[idx]
            return StripCandidateLine(
                index: idx,
                duet: l.isDuet || l.align == "right",
                background: l.isBackground,
                ownedByFocus: l.owner == focusIdx
            )
        }

        let others = state.active.filter { $0 != focusIdx }.map(makeCandidate)
        let slots = StripSlotSolver.placeStripLines(focus: makeCandidate(focusIdx), others: others)

        if slots.isEmpty {
            return (
                [
                    IslandStore.StripRenderItem(
                        trackId: trackId,
                        lineIndex: focusIdx,
                        line: lines[focusIdx],
                        nextLineStart: nextStartFor(focusIdx),
                        slot: nil,
                        isFocus: true
                    )
                ],
                nil
            )
        }

        let orderedIndices = slots.keys.sorted()
        let items = orderedIndices.map { idx in
            IslandStore.StripRenderItem(
                trackId: trackId,
                lineIndex: idx,
                line: lines[idx],
                nextLineStart: nextStartFor(idx),
                slot: slots[idx],
                isFocus: idx == focusIdx
            )
        }
        return (items, nil)
    }

    /// 计算收起态单行条当前焦点行相对上一条主唱行的推进间隔（ms），供 <420ms 快切段收紧弹簧阻尼
    static func mainLineStepIntervalMs(
        forFocusIndex focusIdx: Int?,
        in lines: [LyricLinePayload]
    ) -> Double? {
        guard let focusIdx, lines.indices.contains(focusIdx), focusIdx > 0 else {
            return nil
        }
        let currentStart = lines[focusIdx].start
        for i in stride(from: focusIdx - 1, through: 0, by: -1) where !lines[i].isBackground {
            let delta = currentStart - lines[i].start
            return delta > 0 ? delta : nil
        }
        return nil
    }

    /// 1:1 对齐 music-page-controls.tsx handleCopyLyrics：按当前音译/翻译开关动态排版整首歌词文本
    static func formatLyricsForClipboard(
        track: IslandTrack?,
        lyrics: LyricsBundlePayload,
        preferences: IslandLyricPreferences
    ) -> String? {
        guard !lyrics.lines.isEmpty else { return nil }
        let title = track?.name ?? ""
        let artistStr = (track?.artists ?? []).joined(separator: " / ")
        let header = title.isEmpty ? "" : "\(title)\(artistStr.isEmpty ? "" : " - \(artistStr)")\n\n"

        var groups: [[String]] = []
        for line in lyrics.lines {
            let rawOrig = line.plainText.trimmingCharacters(in: .whitespacesAndNewlines)
            if rawOrig.isEmpty { continue }
            let orig: String
            if line.isBackground {
                let alreadyWrapped = (rawOrig.hasPrefix("(") && rawOrig.hasSuffix(")"))
                    || (rawOrig.hasPrefix("（") && rawOrig.hasSuffix("）"))
                orig = alreadyWrapped ? rawOrig : "(\(rawOrig))"
            } else {
                orig = rawOrig
            }
            var parts = [orig]
            if preferences.showRomaji,
               let roma = line.romanization?.trimmingCharacters(in: .whitespacesAndNewlines),
               !roma.isEmpty {
                parts.append(roma)
            }
            if preferences.showTranslation {
                if let trans = line.translation?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !trans.isEmpty {
                    parts.append(trans)
                }
                if let sec = line.secondaryTranslation?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !sec.isEmpty {
                    parts.append(sec)
                }
            }
            groups.append(parts)
        }
        guard !groups.isEmpty else { return nil }
        let hasExtra = groups.contains { $0.count > 1 }
        let content = groups.map { $0.joined(separator: "\n") }.joined(separator: hasExtra ? "\n\n" : "\n")
        let fullText = (header + content).trimmingCharacters(in: .whitespacesAndNewlines)
        return fullText.isEmpty ? nil : fullText
    }

    /// 1:1 对齐 web/src/lib/lyrics/lyric-glow.ts + desktop-island-bridge.tsx：
    /// 副歌区间内默认使用柔和常亮辉光（strong=false），仅在聚光灯句或当前正唱到带强度的强调短语时升为强档（strong=true）
    static func chorusGlow(
        at ms: Double,
        lyrics: LyricsBundlePayload,
        chorusRanges: [TimeIntervalRange],
        enabled: Bool,
        accentHex: String?
    ) -> IslandGlowPayload? {
        guard enabled else { return nil }
        let inChorus = chorusRanges.contains { ms >= $0.start && ms < $0.end }
        guard inChorus else { return nil }

        let fallbackColor = accentHex ?? "#60a5fa"
        guard let lineIdx = lyrics.lines.firstIndex(where: { !$0.isBackground && ms >= $0.start && ms < $0.end }) else {
            return IslandGlowPayload(color: fallbackColor, strong: false)
        }
        let line = lyrics.lines[lineIdx]
        var resolvedColor: String? = nil
        var strong = lyrics.spotlights.contains(lineIdx)
        for group in line.emphasis {
            let effectiveEnd = group.start + max(LyricSpecs.emphasisMinMs, group.end - group.start)
            guard ms >= group.start && ms < effectiveEnd else { continue }
            if group.factor > 0 {
                strong = true
            }
            if resolvedColor == nil, let hex = group.colorHex, !hex.isEmpty {
                resolvedColor = hex
            }
        }
        let finalColor = resolvedColor ?? line.moodHex ?? fallbackColor
        return IslandGlowPayload(color: finalColor, strong: strong)
    }
}
