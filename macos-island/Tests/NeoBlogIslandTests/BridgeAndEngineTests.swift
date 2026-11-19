import AppKit
import Foundation
@preconcurrency import MediaPlayer
import SwiftUI
import Testing
@testable import NeoBlogIsland

@Suite("NeoBlogIsland 协议、时钟与对齐核心回归测试")
struct BridgeAndEngineTests {
    @Test("NWProtocolWebSocket 能完整重组超过 256KB 的分片 TTML 大歌词消息并正确解析右对齐与毫秒时长")
    @MainActor
    func largeFragmentedWebSocketMessageAndOriginGuard() async throws {
        let server = LocalBridgeServer()
        var receivedPayloads: [Data] = []
        server.onRawJSONMessage = { _, _, data in
            receivedPayloads.append(data)
        }
        server.start(preferredPorts: [29189])
        defer { server.stop() }

        for _ in 0..<25 where server.boundPort == 0 {
            try await Task.sleep(for: .milliseconds(30))
        }
        #expect(server.boundPort == 29189)

        // 构造约 320KB 的超长逐字 TTML media JSON（远超浏览器单帧 64KB 阈值，验证分片重组完整性）
        var lineFragments: [String] = []
        lineFragments.reserveCapacity(600)
        for idx in 0..<600 {
            let align = idx % 2 == 1 ? "right" : "left"
            let isDuet = idx % 2 == 1 ? "true" : "false"
            let base = idx * 1000
            let words = (0..<8).map { w in
                #"{"text":"字\#(w)","start":\#(base + w * 100),"end":\#(base + w * 100 + 95)}"#
            }.joined(separator: ",")
            let lineJSON = """
            {"start":\(base),"end":\(base + 900),"is_duet":\(isDuet),"is_background":false,"align":"\(align)","owner":-1,"translation":"这是第 \(idx) 句超长多语种歌词翻译文本用于验证分片重组完整性","romanization":"kore wa dai \(idx) ku no choucho romaji tesuto desu","words":[\(words)],"emphasis":[{"from":2,"to":6,"start":\(base + 200),"end":\(base + 600),"factor":0.9,"effect":"swell","color_hex":"#fbbf24","styles":["bold"]}]}
            """
            lineFragments.append(lineJSON)
        }

        let fullJSON = """
        {"v":2,"type":"media","tab_id":"tab_test_large","origin":"http://localhost:3000","track":{"id":9527,"name":"分片压测曲目","artists":["歌手A","歌手B"],"inline_title":"分片压测曲目 - 歌手A / 歌手B","album":"测试专辑","duration_ms":215000},"lyrics":{"source":"ttml-custom","font":"kai","word_synced":true,"instrumental":false,"spotlights":[12],"interludes":[],"lines":[\(lineFragments.joined(separator: ","))]}}
        """
        let jsonData = Data(fullJSON.utf8)
        #expect(jsonData.count > 260_000)

        var req = URLRequest(url: URL(string: "ws://127.0.0.1:29189/ws?tab_id=tab_test_large")!)
        req.setValue("http://localhost:3000", forHTTPHeaderField: "Origin")
        let wsTask = URLSession.shared.webSocketTask(with: req)
        wsTask.resume()
        defer { wsTask.cancel(with: .goingAway, reason: nil) }

        try await wsTask.send(.string(fullJSON))
        // 连续在同一条长连接上发送多帧消息（模拟真实前端连接后连发 media + rhythm + playlist + 多条 state 心跳），验证长连接绝不会在首条消息后误断开
        try await wsTask.send(.string(#"{"v":2,"type":"rhythm","tab_id":"tab_test_large","track_id":9527,"rhythm":{"reliable":false,"base_period_ms":750,"trains":{}}}"#))
        try await wsTask.send(.string(#"{"v":2,"type":"state","tab_id":"tab_test_large","visible":true,"has_played":true,"show_playing":true,"is_playing":true,"track_id":9527,"duration_ms":215000,"position_ms":1200,"anchor_ms":1700000000000}"#))
        try await wsTask.send(.string(#"{"v":2,"type":"state","tab_id":"tab_test_large","visible":true,"has_played":true,"show_playing":true,"is_playing":true,"track_id":9527,"duration_ms":215000,"position_ms":3700,"anchor_ms":1700000002500}"#))

        for _ in 0..<50 where receivedPayloads.count < 4 {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(receivedPayloads.count == 4)
        let decoded = try JSONDecoder().decode(WebMediaMessage.self, from: #require(receivedPayloads.first))
        #expect(decoded.track?.id == 9527)
        #expect(decoded.track?.durationMs == 215_000)
        #expect(decoded.lyrics?.lines.count == 600)
        #expect(decoded.lyrics?.lines[1].align == "right")
    }

    @Test("duration_ms 毫秒契约不发生二次乘 1000，且 HDR 擦除遮罩未唱侧亮度连续无跳变")
    func durationMsContractAndHdrMaskContinuity() throws {
        let stateJSON = Data("""
        {
          "type": "state",
          "tab_id": "tab_1",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 42,
          "duration_ms": 200000,
          "position_ms": 50000,
          "anchor_ms": 1700000000000,
          "play_mode": "repeat-all",
          "volume": 0.8,
          "muted": false,
          "preferences": {
            "show_translation": true,
            "show_romaji": true,
            "show_lyric_effects": true
          },
          "config": {
            "form_mode": "auto",
            "expandable": true,
            "beat_bars": true,
            "chorus_glow": true,
            "hdr": true
          }
        }
        """.utf8)

        let state = try JSONDecoder().decode(WebStateMessage.self, from: stateJSON)
        #expect(state.durationMs == 200_000)
        #expect(state.positionMs == 50_000)
        #expect(state.hasPlayed == true)

        let baseDim = LyricSpecs.inactiveAlpha
        let preWipeAlpha = Color.hdrMaskDimAlpha(baseDimAlpha: baseDim, gain: 1.0, hdrEnabled: true)
        let gain = 1.55
        let activeRightMaskAlpha = Color.hdrMaskDimAlpha(baseDimAlpha: baseDim, gain: gain, hdrEnabled: true)
        let esrgbGain = 1.055 * pow(gain, 1.0 / 2.4) - 0.055
        #expect(abs(activeRightMaskAlpha * esrgbGain - preWipeAlpha) < 1e-6)
    }

    @Test("DebrisEngine @Observable 仅在粒子生灭边界翻转 hasActiveDebris，LyricLinePayload 预计算纯文本")
    @MainActor
    func observableDebrisBoundaryAndPlainTextCache() throws {
        let engine = DebrisEngine()
        #expect(engine.hasActiveDebris == false)
        engine.triggerDissolveIfNeeded(
            key: "c0",
            at: 1000,
            nowMs: 1050,
            rect: CGRect(x: 10, y: 10, width: 18, height: 20),
            color: .white
        )
        #expect(engine.hasActiveDebris == true)
        engine.reset()
        #expect(engine.hasActiveDebris == false)

        let lineJSON = Data(#"{"start":0,"end":1000,"align":"right","words":[{"text":"对","start":0,"end":500},{"text":"唱","start":500,"end":1000}]}"#.utf8)
        let line = try JSONDecoder().decode(LyricLinePayload.self, from: lineJSON)
        #expect(line.plainText == "对唱")
        #expect(line.align == "right")
    }

    @Test("逐字振假名 word.ruby、逐音节音译 romanization_words、聚光灯与 18+custom 粒子信号完整解析")
    @MainActor
    func synchronizedRubySpotlightAndStageSignals() throws {
        let bundleJSON = Data("""
        {
          "source": "ttml-amll",
          "word_synced": true,
          "instrumental": false,
          "spotlights": [0],
          "sprites": {
            "sakura": {
              "name": "sakura",
              "paths": [{"d": "M12 2 L15 9 L22 12 L15 15 L12 22 L9 15 L2 12 L9 9 Z", "paint": "fill"}],
              "motion": "swirl",
              "size": "m",
              "spin": true,
              "color_hex": "#ffb3c8"
            }
          },
          "interludes": [{"start": 0, "end": 8000}],
          "lines": [
            {
              "start": 8000,
              "end": 12000,
              "align": "left",
              "paragraph_start": true,
              "chorus_start": true,
              "singer_dot_only": true,
              "edge_colors": ["#74c0fc"],
              "scene": "custom:sakura",
              "scene_lines": 4,
              "romanization": "ha na bi",
              "romanization_words": [
                {"text": "ha", "start": 8000, "end": 9000, "word": 0},
                {"text": "na", "start": 9000, "end": 10000, "word": 0},
                {"text": "bi", "start": 10000, "end": 12000, "word": 1}
              ],
              "words": [
                {
                  "text": "花",
                  "start": 8000,
                  "end": 10000,
                  "ruby": [
                    {"text": "は", "start": 8000, "end": 9000},
                    {"text": "な", "start": 9000, "end": 10000}
                  ]
                },
                {
                  "text": "火",
                  "start": 10000,
                  "end": 12000,
                  "ruby": [
                    {"text": "び", "start": 10000, "end": 12000}
                  ]
                }
              ],
              "emphasis": [
                {"from": 0, "to": 2, "start": 8000, "end": 12000, "factor": 0.9, "effect": "swell", "color_hex": "#ffb3c8", "styles": ["bold"]}
              ]
            }
          ]
        }
        """.utf8)

        let bundle = try JSONDecoder().decode(LyricsBundlePayload.self, from: bundleJSON)
        #expect(bundle.footerLabel == "歌词来自 AMLL TTML 歌词库")
        #expect(bundle.lines.count == 1)
        let first = bundle.lines[0]
        #expect(first.hasFurigana == true)
        #expect(first.words[0].ruby?.count == 2)
        #expect(first.words[0].ruby?[0].text == "は")
        #expect(first.romanizationWords.count == 3)
        #expect(first.paragraphStart == true)
        #expect(first.singerDotOnly == true)

        let spotMid = StageSignalsSolver.spotlightAt(lyrics: bundle, timeMs: 9000)
        #expect(spotMid?.line == 0)
        #expect((spotMid?.level ?? 0) > 0.99)

        let signals = StageSignalsSolver.compute(lyrics: bundle, chorusRanges: [], rhythm: .fallback, timeMs: 8150)
        #expect(signals.burst > 0.5)
        #expect(signals.spotlightLevel > 0.4)
        #expect(signals.scene?.name == "custom:sakura")
        #expect(signals.scene?.sprite?.name == "sakura")

        let svgPath = SVGPathParser.parse("M12 2 L15 9 L22 12 Z")
        #expect(!svgPath.isEmpty)

        // 验证 StageSpringEngine 换行时自上而下阶梯延迟波浪物理特性（前排先动、后排延后启动，非整块刚性平移）
        let line0 = try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":0,"end":1000,"words":[{"text":"句一","start":0,"end":1000}]}"#.utf8))
        let line1 = try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":1000,"end":2000,"words":[{"text":"句二","start":1000,"end":2000}]}"#.utf8))
        let line2 = try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":2000,"end":3000,"words":[{"text":"句三","start":2000,"end":3000}]}"#.utf8))
        let lines = [line0, line1, line2]
        let entries: [StageTimelineEntry] = [
            .line(IndexedLyricLine(id: "1-0", index: 0, line: line0, singerDots: [])),
            .line(IndexedLyricLine(id: "1-1", index: 1, line: line1, singerDots: [])),
            .line(IndexedLyricLine(id: "1-2", index: 2, line: line2, singerDots: []))
        ]

        let springStage = StageSpringEngine()
        let t0 = Date(timeIntervalSinceReferenceDate: 1000.0)
        let frame0 = springStage.stepLayout(
            entries: entries,
            lines: lines,
            stageHeight: 176,
            showRomaji: false,
            showTranslation: false,
            date: t0,
            nowMs: 500,
            tState: (active: [0], focus: 0, interlude: nil),
            spot: nil
        )
        #expect(frame0.count == 3)

        // 推进 30ms 进入下一句（500ms -> 1020ms < 1000ms 跳转阈值，触发阶梯入场延迟：第 0 行 delay=0 立即上移，第 2 行 delay≈97ms 仍停留在原位）
        let t1 = t0.addingTimeInterval(0.030)
        let frame1 = springStage.stepLayout(
            entries: entries,
            lines: lines,
            stageHeight: 176,
            showRomaji: false,
            showTranslation: false,
            date: t1,
            nowMs: 1020,
            tState: (active: [1], focus: 1, interlude: nil),
            spot: nil
        )
        let dy0 = abs(frame1[0].y - frame0[0].y)
        let dy2 = abs(frame1[2].y - frame0[2].y)
        #expect(dy0 > 0.5)
        #expect(dy2 < 0.01)
        #expect(springStage.isAnimating == true)
    }

    @Test("歌单内搜索：支持别名、平片假名互通、空格多词与歌曲 ID 权重排序")
    func testPlaylistSearchFilter() {
        let sample: [PlaylistTrackItem] = [
            PlaylistTrackItem(
                index: 0,
                id: 1001,
                name: "インターネットやめろ",
                aliases: ["戒网吧"],
                titleExtra: "戒网吧",
                artists: "Aiobahn / KOTOKO",
                album: "NEEDY GIRL OVERDOSE",
                durationMs: 215_000
            ),
            PlaylistTrackItem(
                index: 1,
                id: 2668056312,
                name: "天天天国地獄国 (feat. ななひら & P丸様。)",
                aliases: ["天天天国地狱国"],
                titleExtra: "天天天国地狱国",
                artists: "Aiobahn +81 / ななひら / P丸様。",
                album: "天天天国地獄国",
                durationMs: 228_428
            )
        ]

        // 1. 简体别名检索命中繁体/日文汉字原名
        let byAlias = PlaylistSearchFilter.filter(sample, query: "地狱国")
        #expect(byAlias.map(\.id) == [2668056312])

        // 2. 片假名查询「ナナヒラ」命中平假名歌手「ななひら」+ 空格多词联合过滤
        let byKanaAndMulti = PlaylistSearchFilter.filter(sample, query: "ナナヒラ aiobahn")
        #expect(byKanaAndMulti.map(\.id) == [2668056312])

        // 3. 纯数字 ID 精确置顶检索
        let byId = PlaylistSearchFilter.filter(sample, query: "2668056312")
        #expect(byId.map(\.id) == [2668056312])
        #expect(byId.first?.formattedDuration == "03:48")
    }

    @Test("多歌手胶囊与聚光灯切句无反向掉帧（修复 pillOffset 双重扣除）及六档 motion 律动预设与快切阻尼保护")
    @MainActor
    func testNoDownwardDipOnSingerPillAndMotionPresets() throws {
        // 1. 验证六档预设与收起态胶囊快切推进间隔求解、阻尼收紧
        let bouncyNormal = LyricSpecs.resolveMotionSprings(motion: "bouncy", stepIntervalMs: 1800)
        let bouncyRapid = LyricSpecs.resolveMotionSprings(motion: "bouncy", stepIntervalMs: 200)
        let plushNormal = LyricSpecs.resolveMotionSprings(motion: "plush", stepIntervalMs: 1800)
        let gentleNormal = LyricSpecs.resolveMotionSprings(motion: "gentle", stepIntervalMs: 1800)
        #expect(bouncyNormal.position.stiffness == 165)
        #expect(plushNormal.position.stiffness == 90)
        #expect(gentleNormal.position.stiffness == 68)
        #expect(abs(gentleNormal.position.damping - 2.0 * 0.96 * 68.0.squareRoot()) < 1e-6)
        #expect(bouncyNormal.inactiveScale == 0.885)
        #expect(bouncyRapid.position.stiffness >= bouncyNormal.position.stiffness)
        #expect(bouncyRapid.position.damping > bouncyNormal.position.damping)

        let bgMid = try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":1120,"end":1900,"is_background":true,"owner":0,"words":[{"text":"和声","start":1120,"end":1900}]}"#.utf8))
        let stripSample = [
            try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":1000,"end":1300,"words":[{"text":"一","start":1000,"end":1300}]}"#.utf8)),
            bgMid,
            try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":1280,"end":2000,"words":[{"text":"二","start":1280,"end":2000}]}"#.utf8))
        ]
        #expect(StageTimelineEngine.mainLineStepIntervalMs(forFocusIndex: 0, in: stripSample) == nil)
        // 跳过中间的 x-bg 背景和声，准确量出两条主唱行 280ms (<420ms) 的快切间隔
        #expect(StageTimelineEngine.mainLineStepIntervalMs(forFocusIndex: 2, in: stripSample) == 280)

        // 2. 验证带歌手胶囊 + 聚光灯的句子唱完切入下一句时，y 单调向上减小，不再先往下掉 18px
        let l0 = try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":0,"end":1000,"singer_name":"甲","words":[{"text":"首句","start":0,"end":1000}]}"#.utf8))
        let l1 = try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":1000,"end":2000,"singer_name":"乙","words":[{"text":"高潮点题","start":1000,"end":2000}]}"#.utf8))
        let l2 = try JSONDecoder().decode(LyricLinePayload.self, from: Data(#"{"start":2050,"end":3200,"singer_name":"甲","words":[{"text":"下一句","start":2050,"end":3200}]}"#.utf8))
        let lines = [l0, l1, l2]
        let dots = [SingerColorDot(id: "v1", hex: "#ff6f91")]
        let entries: [StageTimelineEntry] = [
            .line(IndexedLyricLine(id: "m-0", index: 0, line: l0, singerDots: dots)),
            .line(IndexedLyricLine(id: "m-1", index: 1, line: l1, singerDots: dots)),
            .line(IndexedLyricLine(id: "m-2", index: 2, line: l2, singerDots: dots))
        ]

        let engine = StageSpringEngine()
        var clock = Date(timeIntervalSinceReferenceDate: 2000.0)

        // 先稳定停在第 1 句（聚光灯满强 + 胶囊展开）
        var lastPlaced = engine.stepLayout(
            entries: entries, lines: lines, stageHeight: 200,
            showRomaji: false, showTranslation: false,
            date: clock, nowMs: 1800,
            tState: (active: [1], focus: 1, interlude: nil),
            spot: (line: 1, level: 1.0),
            motion: "bouncy"
        )
        for _ in 0..<45 {
            clock = clock.addingTimeInterval(1.0 / 60.0)
            lastPlaced = engine.stepLayout(
                entries: entries, lines: lines, stageHeight: 200,
                showRomaji: false, showTranslation: false,
                date: clock, nowMs: 1900,
                tState: (active: [1], focus: 1, interlude: nil),
                spot: (line: 1, level: 1.0),
                motion: "bouncy"
            )
        }
        let startY = try #require(lastPlaced.first(where: { $0.entryIndex == 1 })?.y)

        // 切入第 2 句，且第 1 句聚光灯处于 600ms 缓出窗口内：逐帧检查第 1 句绝不向下掉（curY <= startY）
        var maxY = startY
        var finalY = startY
        for step in 1...25 {
            clock = clock.addingTimeInterval(0.016)
            let nowMs = 2050.0 + Double(step) * 16.0
            let rel = max(0.0, 1.0 - (nowMs - 2000.0) / 600.0)
            let spotLv = rel * rel * (3.0 - 2.0 * rel)
            let placed = engine.stepLayout(
                entries: entries, lines: lines, stageHeight: 200,
                showRomaji: false, showTranslation: false,
                date: clock, nowMs: nowMs,
                tState: (active: [2], focus: 2, interlude: nil),
                spot: spotLv > 0 ? (line: 1, level: spotLv) : nil,
                motion: "bouncy"
            )
            if let row1 = placed.first(where: { $0.entryIndex == 1 }) {
                if row1.y > maxY { maxY = row1.y }
                finalY = row1.y
            }
        }
        #expect(maxY <= startY + 0.05)
        #expect(finalY < startY - 12.0)

        // 验证小窗多行同时演唱时水平同步线折中：双行同唱比单行独唱温和上移，且三行高跨度同唱首行不越过 12% 顶部安全线
        func decodeTestLine(start: Int, end: Int, text: String, translation: String) throws -> LyricLinePayload {
            let json = #"{"start":\#(start),"end":\#(end),"translation":"\#(translation)","words":[{"text":"\#(text)","start":\#(start),"end":\#(end)}]}"#
            return try JSONDecoder().decode(LyricLinePayload.self, from: Data(json.utf8))
        }
        let multiLines: [LyricLinePayload] = [
            try decodeTestLine(start: 0, end: 2000, text: "独唱转双声部首句", translation: "首句翻译"),
            try decodeTestLine(start: 1000, end: 2000, text: "第二声部加入同唱", translation: "次句翻译"),
            try decodeTestLine(start: 2200, end: 3200, text: "三声部同唱甲", translation: "甲译"),
            try decodeTestLine(start: 2200, end: 3200, text: "三声部同唱乙", translation: "乙译"),
            try decodeTestLine(start: 2200, end: 3200, text: "三声部同唱丙", translation: "丙译"),
        ]
        let multiEntries: [StageTimelineEntry] = multiLines.enumerated().map { idx, l in
            .line(IndexedLyricLine(id: "multi-\(idx)", index: idx, line: l, singerDots: []))
        }
        let multiEngine = StageSpringEngine()
        var mClock = Date(timeIntervalSinceReferenceDate: 5000.0)
        var soloPlaced = multiEngine.stepLayout(
            entries: multiEntries, lines: multiLines, stageHeight: 200,
            showRomaji: false, showTranslation: true,
            date: mClock, nowMs: 500,
            tState: (active: [0], focus: 0, interlude: nil),
            spot: nil, motion: "flow"
        )
        for _ in 0..<45 {
            mClock = mClock.addingTimeInterval(1.0 / 60.0)
            soloPlaced = multiEngine.stepLayout(
                entries: multiEntries, lines: multiLines, stageHeight: 200,
                showRomaji: false, showTranslation: true,
                date: mClock, nowMs: 600,
                tState: (active: [0], focus: 0, interlude: nil),
                spot: nil, motion: "flow"
            )
        }
        let soloLine0Y = try #require(soloPlaced.first(where: { $0.entryIndex == 0 })?.y)

        var duoPlaced = soloPlaced
        for _ in 0..<55 {
            mClock = mClock.addingTimeInterval(1.0 / 60.0)
            duoPlaced = multiEngine.stepLayout(
                entries: multiEntries, lines: multiLines, stageHeight: 200,
                showRomaji: false, showTranslation: true,
                date: mClock, nowMs: 1400,
                tState: (active: [0, 1], focus: 0, interlude: nil),
                spot: nil, motion: "flow"
            )
        }
        let duoLine0Y = try #require(duoPlaced.first(where: { $0.entryIndex == 0 })?.y)
        let duoLine1Y = try #require(duoPlaced.first(where: { $0.entryIndex == 1 })?.y)
        #expect(duoLine0Y < soloLine0Y - 8.0)
        #expect(duoLine0Y >= 23.5)
        #expect(duoLine1Y < 130.0)

        var trioPlaced = duoPlaced
        for _ in 0..<60 {
            mClock = mClock.addingTimeInterval(1.0 / 60.0)
            trioPlaced = multiEngine.stepLayout(
                entries: multiEntries, lines: multiLines, stageHeight: 200,
                showRomaji: false, showTranslation: true,
                date: mClock, nowMs: 2600,
                tState: (active: [2, 3, 4], focus: 2, interlude: nil),
                spot: nil, motion: "flow"
            )
        }
        let trioFirstY = try #require(trioPlaced.first(where: { $0.entryIndex == 2 })?.y)
        #expect(trioFirstY >= 23.5)
    }

    @Test("跨 Mac 点对点互联：首次配对授权、全量歌词快照与时钟同步、屏幕边缘甩屏传岛及反向控播")
    @MainActor
    func testCrossMacPeerContinuityHandoffAndRemoteControl() async throws {
        let suiteA = "NeoBlogIslandTest.MacA.\(UUID().uuidString)"
        let suiteB = "NeoBlogIslandTest.MacB.\(UUID().uuidString)"
        let defaultsA = try #require(UserDefaults(suiteName: suiteA))
        let defaultsB = try #require(UserDefaults(suiteName: suiteB))
        defer {
            defaultsA.removePersistentDomain(forName: suiteA)
            defaultsB.removePersistentDomain(forName: suiteB)
        }

        let peerA = PeerContinuityService(overridePeerId: "aaaa1111-2222-3333-4444-555555555555", overrideDeviceName: "MacBook Pro", isolatedDefaults: defaultsA)
        let peerB = PeerContinuityService(overridePeerId: "bbbb1111-2222-3333-4444-555555555555", overrideDeviceName: "Mac Studio", isolatedDefaults: defaultsB)
        let macA = IslandStore(startNetworkServices: false, peerService: peerA)
        let macB = IslandStore(startNetworkServices: false, peerService: peerB)
        defer {
            peerA.stop()
            peerB.stop()
        }

        var receivedCommandsOnMacA: [String] = []
        macA.onInterceptCommandForTest = { cmd in
            receivedCommandsOnMacA.append(cmd.action)
        }
        var lastArrivedPortalOnMacB: PeerPortalPayload? = nil
        macB.onReceivePortalArrival = { portal in
            lastArrivedPortalOnMacB = portal
        }

        // 1. Mac A 本地浏览器正在播放曲目
        let localTabId = UUID()
        let mediaJSON = Data(#"{"type":"media","track":{"id":2668056312,"name":"天天天国地獄国","artists":["Aiobahn"],"album":"Single","duration_ms":228428},"lyrics":{"source":"ttml-custom","motion":"bouncy","word_synced":true,"instrumental":false,"spotlights":[],"interludes":[],"lines":[{"start":0,"end":5000,"words":[{"text":"テスト","start":0,"end":5000}]}]}}"#.utf8)
        let stateJSON = Data(#"{"type":"state","visible":true,"show_playing":true,"is_playing":true,"has_played":true,"track_id":2668056312,"position_ms":42500,"duration_ms":228428,"anchor_ms":1700000000000}"#.utf8)
        macA.ingestTestPayload(mediaJSON, clientId: localTabId)
        macA.ingestTestPayload(stateJSON, clientId: localTabId)
        #expect(macA.shouldDisplayIsland == true)
        #expect(macA.config.formMode == .floatingCapsule)

        // 2. 启动回环监听并由 Mac B 发起首次配对连接
        peerA.startLoopbackForTesting()
        for _ in 0..<40 where peerA.directListeningPort == 0 {
            try await Task.sleep(for: .milliseconds(15))
        }
        let port = peerA.directListeningPort
        #expect(port > 0)

        peerB.connectLoopbackForTesting(port: port, requestPairingIfUntrusted: true)
        for _ in 0..<50 where peerA.pendingPairRequest == nil {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(peerA.pendingPairRequest?.deviceName == "Mac Studio")

        // 3. Mac A 点击「允许」确认配对 -> 双方自动互存信任 Token，Mac B 立即收到完整曲目与毫秒时钟
        peerA.respondToPairRequest(accept: true)
        for _ in 0..<60 where macB.track?.id != 2668056312 {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(peerA.isConnected == true)
        #expect(peerB.isConnected == true)
        #expect(macB.track?.name == "天天天国地獄国")
        #expect(macB.lyrics.motion == "bouncy")
        #expect(macB.currentPositionMs() >= 42_500)
        // 未把岛拖过去之前，仅播放主机 Mac A 显示，镜像机 Mac B 保持安静待命
        #expect(macA.shouldDisplayIsland == true)
        #expect(macB.shouldDisplayIsland == false)

        // 4. 从 Mac A 右屏幕边缘（状态栏高度）把胶囊甩向 Mac B -> Mac A 自动收起隐藏，Mac B 左边缘接棒显示并停靠状态栏
        macA.commitPortalThrow(PeerPortalPayload(fromEdge: .right, offsetFromTopPt: 12, dockedInMenuBar: true))
        for _ in 0..<50 where !macB.shouldDisplayIsland {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(macA.shouldDisplayIsland == false)
        #expect(macB.shouldDisplayIsland == true)
        #expect(lastArrivedPortalOnMacB?.fromEdge.oppositeOnReceivingMac == .left)
        #expect(lastArrivedPortalOnMacB?.dockedInMenuBar == true)

        // 5. 在 Mac B 上点击「下一首」-> 反向控制指令实时穿透回 Mac A
        macB.nextTrack()
        for _ in 0..<50 where !receivedCommandsOnMacA.contains("next") {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(receivedCommandsOnMacA.contains("next"))

        // 6. 在 Mac B 展开小窗后从左屏幕边缘甩回 Mac A -> Mac B 收起，Mac A 重新接棒并保持展开小窗形态
        macB.commitPortalThrow(PeerPortalPayload(fromEdge: .left, offsetFromTopPt: 26, dockedInMenuBar: false, isExpanded: true))
        for _ in 0..<50 where !macA.shouldDisplayIsland {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(macA.shouldDisplayIsland == true)
        #expect(macA.isExpanded == true)
        #expect(macB.shouldDisplayIsland == false)
    }

    @Test("点击全屏按钮唤醒浏览器并切回播放 Tab：Chromium / Arc / Safari AppleScript 方言生成与 focus_token 握手")
    @MainActor
    func testBrowserTabActivatorScriptGenerationAndFocusHandshake() throws {
        let chromeTokenScript = BrowserTabActivator.buildAppleScript(
            bundleId: "com.google.Chrome",
            dialect: .chromium,
            focusToken: "nbf_1234abcd",
            origin: nil
        )
        #expect(chromeTokenScript.contains(#"tell application id "com.google.Chrome""#))
        #expect(chromeTokenScript.contains(#"title of t contains "nbf_1234abcd""#))
        #expect(chromeTokenScript.contains("set active tab index of w to tIdx"))

        let arcTokenScript = BrowserTabActivator.buildAppleScript(
            bundleId: "company.thebrowser.Browser",
            dialect: .arc,
            focusToken: "nbf_1234abcd",
            origin: nil
        )
        #expect(arcTokenScript.contains("tell t to select"))

        let safariFallbackScript = BrowserTabActivator.buildAppleScript(
            bundleId: "com.apple.Safari",
            dialect: .safari,
            focusToken: nil,
            origin: "https://blog.example.com"
        )
        #expect(safariFallbackScript.contains("set current tab of w to t"))
        #expect(safariFallbackScript.contains(#"(u starts with "https://blog.example.com") and (u contains "/music")"#))

        let store = IslandStore(startNetworkServices: false)
        var capturedCmd: OutgoingCommand?
        store.onInterceptCommandForTest = { cmd in
            capturedCmd = cmd
        }
        let clientId = UUID()
        let mediaJSON = Data(#"{"type":"media","origin":"https://blog.example.com","user_agent":"Mozilla/5.0 Chrome/136.0.0.0","track":{"id":1,"name":"Test","artists":["A"],"album":"B","duration_ms":180000}}"#.utf8)
        store.ingestTestPayload(mediaJSON, clientId: clientId, origin: "https://blog.example.com")
        store.isExpanded = true
        store.openBlogPlayerPage()

        #expect(store.isExpanded == false)
        #expect(capturedCmd?.action == "open_player_page")
        #expect(capturedCmd?.focusToken?.hasPrefix("nbf_") == true)

        // 验证前后相邻歌曲预热包：点击下一首/上一首时 0ms 乐观切入已预热的封面与歌词，且忽略滞后的旧曲目心跳
        let preloadJSON = Data(##"{"type":"preload","next_track_id":202,"prev_track_id":200,"items":[{"track":{"id":202,"name":"预热下一首","artists":["NextArtist"],"album":"Album2","duration_ms":210000},"accent_hex":"#4ade80","chorus":[{"start":30000,"end":60000}],"lyrics":{"source":"ttml-amll","word_synced":true,"instrumental":false,"spotlights":[],"interludes":[],"lines":[{"start":0,"end":4000,"words":[{"text":"下一首首句秒开","start":0,"end":4000}]}]}},{"track":{"id":200,"name":"预热上一首","artists":["PrevArtist"],"album":"Album0","duration_ms":195000},"accent_hex":"#f472b6","chorus":[],"lyrics":{"source":"ncm-yrc","word_synced":true,"instrumental":false,"spotlights":[],"interludes":[],"lines":[{"start":0,"end":3000,"words":[{"text":"上一首首句秒开","start":0,"end":3000}]}]}}]}"##.utf8)
        store.ingestTestPayload(preloadJSON, clientId: clientId, origin: "https://blog.example.com")

        store.nextTrack()
        #expect(store.track?.id == 202)
        #expect(store.track?.name == "预热下一首")
        #expect(store.accentHex == "#4ade80")
        #expect(store.lyrics.lines.first?.plainText == "下一首首句秒开")

        // 旧曲目 (id=1) 的滞后心跳在乐观窗口内不得把画面闪回旧曲目
        let staleState = Data(#"{"type":"state","visible":true,"show_playing":true,"is_playing":true,"has_played":true,"track_id":1,"position_ms":99000,"duration_ms":180000,"anchor_ms":1700000000000}"#.utf8)
        store.ingestTestPayload(staleState, clientId: clientId, origin: "https://blog.example.com")
        #expect(store.track?.id == 202)

        store.prevTrack()
        #expect(store.track?.id == 200)
        #expect(store.lyrics.lines.first?.plainText == "上一首首句秒开")
    }

    @Test("流光线性光混合：权重 0 与底色严格恒等，峰值向超白暖光平滑抬升且字间连续推进")
    func shimmerLinearLightContinuity() {
        let baseEdr = Color.edrCss("#74c0fc", tint: 0.72, gain: 1.65)
        let edgeEdr = Color.edrShimmerMix(
            baseHex: "#74c0fc",
            baseTint: 0.72,
            baseGain: 1.65,
            bandGain: 3.40,
            weight: 0.0
        )
        #expect(baseEdr == edgeEdr)

        let baseSdr = Color.edrCss("#74c0fc", tint: 0.72, gain: 1.0)
        let edgeSdr = Color.edrShimmerMix(
            baseHex: "#74c0fc",
            baseTint: 0.72,
            baseGain: 1.0,
            bandGain: 1.0,
            weight: 0.0
        )
        #expect(baseSdr == edgeSdr)

        // 验证两拍扫光期间光带中心连续穿过字内左边缘(0.0) -> 中心(0.5) -> 字间缝隙(1.0) -> 下一字中心(1.5)
        let rhythm = RhythmEngineContext.fallback // 750ms 一拍，leadMs = 20
        let c0 = rhythm.shimmerCenter(start: 1000, timeMs: 980, count: 4)
        let cMid = rhythm.shimmerCenter(start: 1000, timeMs: 1355, count: 4)
        let cEnd = rhythm.shimmerCenter(start: 1000, timeMs: 1729, count: 4)
        #expect(c0 != nil && abs(c0! - (-1.0)) < 0.01)
        #expect(cMid != nil && abs(cMid! - 2.0) < 0.02)
        #expect(cEnd != nil && cEnd! > 4.9)
    }

    @Test("跨行退场与舞台染色连续性：行结束时 activeBlend 二次缓出、模糊阻尼渐进，对唱换色按指数阻尼混合不跳变")
    @MainActor
    func crossLineExitAndAmbienceContinuity() throws {
        let bundleJSON = Data(##"""
        {
          "source": "ttml-amll",
          "word_synced": true,
          "instrumental": false,
          "spotlights": [],
          "interludes": [],
          "lines": [
            {
              "start": 0,
              "end": 2000,
              "words": [{"text": "第一句", "start": 0, "end": 2000}],
              "align": "left",
              "singer_name": "歌手A",
              "edge_colors": ["#74c0fc"]
            },
            {
              "start": 2000,
              "end": 4000,
              "words": [{"text": "第二句", "start": 2000, "end": 4000}],
              "is_duet": true,
              "align": "right",
              "singer_name": "歌手B",
              "edge_colors": ["#ff6f91"]
            }
          ]
        }
        """##.utf8)
        let bundle = try JSONDecoder().decode(LyricsBundlePayload.self, from: bundleJSON)
        let l0 = bundle.lines[0]
        let l1 = bundle.lines[1]
        let entries: [StageTimelineEntry] = [
            .line(IndexedLyricLine(id: "t-0", index: 0, line: l0, singerDots: [SingerColorDot(id: "0", hex: "#74c0fc")])),
            .line(IndexedLyricLine(id: "t-1", index: 1, line: l1, singerDots: [SingerColorDot(id: "0", hex: "#ff6f91")]))
        ]
        let spring = StageSpringEngine()
        let t0 = Date(timeIntervalSinceReferenceDate: 1000.0)

        // 第 0 句演唱中：activeBlend == 1.0，blurProgress == 0.0
        let frame0 = spring.stepLayout(
            entries: entries, lines: [l0, l1], stageHeight: 200,
            showRomaji: false, showTranslation: false,
            date: t0, nowMs: 1500,
            tState: (active: [0], focus: 0, interlude: nil), spot: nil
        )
        let row0Active = frame0.first(where: { $0.entryIndex == 0 })!
        #expect(row0Active.isActive == true)
        #expect(row0Active.activeBlend == 1.0)
        #expect(row0Active.blurProgress == 0.0)

        // 刚切到第 1 句后 50ms：第 0 句虽已非激活，但 activeBlend 仍处于平滑退场中（~0.77），blurProgress 从 0 渐进抬升而非瞬跳到 1
        let frame1 = spring.stepLayout(
            entries: entries, lines: [l0, l1], stageHeight: 200,
            showRomaji: false, showTranslation: false,
            date: t0.addingTimeInterval(0.05), nowMs: 2050,
            tState: (active: [1], focus: 1, interlude: nil), spot: nil
        )
        let row0Exiting = frame1.first(where: { $0.entryIndex == 0 })!
        #expect(row0Exiting.isActive == false)
        #expect(row0Exiting.activeBlend > 0.70 && row0Exiting.activeBlend < 0.90)
        #expect(row0Exiting.blurProgress > 0.05 && row0Exiting.blurProgress < 0.50)

        // 500ms 后退场完成：activeBlend 归零
        var curDate = t0.addingTimeInterval(0.05)
        var lastRow0 = row0Exiting
        for step in 1...10 {
            curDate = t0.addingTimeInterval(0.05 + Double(step) * 0.05)
            let f = spring.stepLayout(
                entries: entries, lines: [l0, l1], stageHeight: 200,
                showRomaji: false, showTranslation: false,
                date: curDate, nowMs: 2050 + Double(step) * 50,
                tState: (active: [1], focus: 1, interlude: nil), spot: nil
            )
            lastRow0 = f.first(where: { $0.entryIndex == 0 })!
        }
        #expect(lastRow0.activeBlend == 0.0)

        // 验证舞台方向染色交接阻尼：左声部 (-0.07) 切到右声部 (+0.07) 首帧不会瞬移到 +0.07，而是平滑插值过渡
        let ambience = StageParticlesEngine(scale: 0.7, maxParticles: 20)
        let s0 = ambience.smoothAmbience(date: t0, tintHex: "#74c0fc", tintAlpha: 0.25, vocalShiftRatio: -0.07)
        #expect(abs(s0.shiftRatio - (-0.07)) < 0.001)
        let s1 = ambience.smoothAmbience(date: t0.addingTimeInterval(0.05), tintHex: "#ff6f91", tintAlpha: 0.25, vocalShiftRatio: 0.07)
        #expect(s1.shiftRatio > -0.065 && s1.shiftRatio < -0.02)
    }

    @Test("应用自更新：Nightly / 正式版通道自动识别、版本与提交比对、SHA256 摘要解析及退出后替换脚本语法校验")
    func appUpdateChannelAndScriptVerification() throws {
        let appURL = URL(fileURLWithPath: "/Applications/NeoBlogIsland.app")

        // 1. 当前运行包通道自动推断
        let stableInstalled = InstalledAppVersion.current(
            info: ["CFBundleShortVersionString": "0.2.0", "CFBundleVersion": "12"],
            bundleURL: appURL
        )
        #expect(stableInstalled.channel == .stable)
        #expect(stableInstalled.displayBadge == "v0.2.0")

        let nightlyInstalled = InstalledAppVersion.current(
            info: ["CFBundleShortVersionString": "0.2.0-nightly.46ab33f", "CFBundleVersion": "14"],
            bundleURL: appURL
        )
        #expect(nightlyInstalled.channel == .nightly)
        #expect(nightlyInstalled.commitSHA == "46ab33f")
        #expect(nightlyInstalled.displayBadge == "Nightly · 46ab33f")

        // 2. GitHub Releases JSON 解析（过滤非灵动岛 tag，准确提取最新正式版与 Nightly）
        let releasesJSON = Data(##"""
        [
          {
            "tag_name": "v2.5.0",
            "name": "Blog Backend v2.5.0",
            "draft": false,
            "prerelease": false,
            "assets": []
          },
          {
            "tag_name": "island-nightly",
            "name": "NeoBlogIsland Nightly (2026-11-17 · 46ab33f)",
            "body": "### NeoBlogIsland Nightly 自动构建\n\n- **版本标识**：`0.2.0-nightly.46ab33f`（Build `#14`）\n- **对应提交**：`46ab33f` (46ab33f61a72cf6be4a2a97c0112312961b67eb8)\n",
            "draft": false,
            "prerelease": true,
            "target_commitish": "46ab33f61a72cf6be4a2a97c0112312961b67eb8",
            "published_at": "2026-11-17T05:29:29Z",
            "assets": [
              {
                "name": "NeoBlogIsland-universal.app.zip",
                "size": 1485763,
                "updated_at": "2026-11-17T16:45:41Z",
                "browser_download_url": "https://github.com/snowykami/neo-blog/releases/download/island-nightly/NeoBlogIsland-universal.app.zip"
              },
              {
                "name": "SHA256SUMS.txt",
                "size": 192,
                "updated_at": "2026-11-17T16:45:40Z",
                "browser_download_url": "https://github.com/snowykami/neo-blog/releases/download/island-nightly/SHA256SUMS.txt"
              }
            ]
          },
          {
            "tag_name": "island-v0.1.9",
            "name": "NeoBlogIsland v0.1.9",
            "draft": false,
            "prerelease": false,
            "assets": [
              {
                "name": "NeoBlogIsland-universal.app.zip",
                "size": 1300000,
                "browser_download_url": "https://example.com/v0.1.9.app.zip"
              }
            ]
          },
          {
            "tag_name": "island-v0.2.0",
            "name": "NeoBlogIsland v0.2.0",
            "draft": false,
            "prerelease": false,
            "assets": [
              {
                "name": "NeoBlogIsland-universal.app.zip",
                "size": 1419038,
                "browser_download_url": "https://example.com/v0.2.0.app.zip"
              },
              {
                "name": "SHA256SUMS.txt",
                "size": 192,
                "browser_download_url": "https://example.com/SHA256SUMS.txt"
              }
            ]
          }
        ]
        """##.utf8)

        let list = try JSONDecoder().decode([GitHubReleaseDTO].self, from: releasesJSON)
        let latestStable = AppUpdateService.selectLatestStableRelease(from: list)
        #expect(latestStable?.tagName == "island-v0.2.0")
        #expect(latestStable?.displayVersion == "v0.2.0")

        let nightlyInfo = AppUpdateService.parseNightlyRelease(list[1])
        #expect(nightlyInfo?.displayVersion == "0.2.0-nightly.46ab33f")
        #expect(nightlyInfo?.commitSHA == "46ab33f61a72cf6be4a2a97c0112312961b67eb8")

        // 3. 同通道升级与跨通道切换判定
        #expect(AppUpdateService.evaluateUpdate(installed: stableInstalled, remote: latestStable!, targetChannel: .stable).available == false)
        let olderStable = InstalledAppVersion.current(
            info: ["CFBundleShortVersionString": "0.1.9"],
            bundleURL: appURL
        )
        #expect(AppUpdateService.evaluateUpdate(installed: olderStable, remote: latestStable!, targetChannel: .stable) == (true, false))

        // Nightly 短 SHA 与远端 40 位 SHA 前缀一致时视为已是最新
        #expect(AppUpdateService.evaluateUpdate(installed: nightlyInstalled, remote: nightlyInfo!, targetChannel: .nightly).available == false)
        let olderNightly = InstalledAppVersion.current(
            info: ["CFBundleShortVersionString": "0.2.0-nightly.10c2d92"],
            bundleURL: appURL
        )
        #expect(AppUpdateService.evaluateUpdate(installed: olderNightly, remote: nightlyInfo!, targetChannel: .nightly) == (true, false))

        // 跨通道切换（Nightly -> 正式版 / 正式版 -> Nightly）
        #expect(AppUpdateService.evaluateUpdate(installed: nightlyInstalled, remote: latestStable!, targetChannel: .stable) == (true, true))
        #expect(AppUpdateService.evaluateUpdate(installed: stableInstalled, remote: nightlyInfo!, targetChannel: .nightly) == (true, true))

        // 4. SHA256SUMS.txt 解析与守护替换脚本 POSIX sh 语法校验
        let sumsText = """
        a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0  NeoBlogIsland-universal.dmg
        0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  NeoBlogIsland-universal.app.zip
        """
        #expect(
            AppUpdateService.parseSHA256Sums(sumsText, assetName: "NeoBlogIsland-universal.app.zip")
                == "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        )

        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("UpdaterScriptTest-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let scriptURL = try AppUpdateService.writeDetachedUpdaterScript(in: tempDir)

        let lintProc = Process()
        lintProc.executableURL = URL(fileURLWithPath: "/bin/sh")
        lintProc.arguments = ["-n", scriptURL.path]
        try lintProc.run()
        lintProc.waitUntilExit()
        #expect(lintProc.terminationStatus == 0)

        // 5. 绕过 GitHub API 限流：releases.atom XML 解析、搜索页 HTML 标签提取与直连强制更新回退
        let atomXML = Data("""
        <?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>tag:github.com,2008:Repository/1/v2.6.0</id>
            <updated>2026-11-18T02:00:00Z</updated>
            <link rel="alternate" type="text/html" href="https://github.com/snowykami/neo-blog/releases/tag/v2.6.0"/>
            <title>Backend v2.6.0</title>
            <content type="html">Backend release</content>
          </entry>
          <entry>
            <id>tag:github.com,2008:Repository/1/island-nightly</id>
            <updated>2026-11-18T03:15:00.450Z</updated>
            <link rel="alternate" type="text/html" href="https://github.com/snowykami/neo-blog/releases/tag/island-nightly"/>
            <title>NeoBlogIsland Nightly (2026-11-18 · 8f9e1a2)</title>
            <content type="html">&lt;ul&gt;&lt;li&gt;&lt;strong&gt;版本标识&lt;/strong&gt;：&lt;code&gt;0.2.0-nightly.8f9e1a2&lt;/code&gt;&lt;/li&gt;&lt;li&gt;&lt;strong&gt;对应提交&lt;/strong&gt;：&lt;code&gt;8f9e1a2&lt;/code&gt; (&lt;a class="commit-link" href="https://github.com/snowykami/neo-blog/commit/8f9e1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b"&gt;&lt;tt&gt;8f9e1a2&lt;/tt&gt;&lt;/a&gt;)&lt;/li&gt;&lt;/ul&gt;</content>
          </entry>
          <entry>
            <id>tag:github.com,2008:Repository/1/island-v0.3.0-beta.1</id>
            <updated>2026-11-18T01:00:00Z</updated>
            <link rel="alternate" type="text/html" href="https://github.com/snowykami/neo-blog/releases/tag/island-v0.3.0-beta.1"/>
            <title>NeoBlogIsland v0.3.0-beta.1</title>
            <content type="html">Beta</content>
          </entry>
          <entry>
            <id>tag:github.com,2008:Repository/1/island-v0.2.1</id>
            <updated>2026-11-17T20:00:00Z</updated>
            <link rel="alternate" type="text/html" href="https://github.com/snowykami/neo-blog/releases/tag/island-v0.2.1"/>
            <title>NeoBlogIsland v0.2.1</title>
            <content type="html">Formal release</content>
          </entry>
        </feed>
        """.utf8)

        let atomParsed = AppUpdateService.parseAtomFeedReleases(atomXML, repoSlug: "snowykami/neo-blog")
        #expect(atomParsed.nightly?.displayVersion == "0.2.0-nightly.8f9e1a2")
        #expect(atomParsed.nightly?.commitSHA == "8f9e1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b")
        #expect(atomParsed.nightly?.zipDownloadURL.absoluteString == "https://github.com/snowykami/neo-blog/releases/download/island-nightly/NeoBlogIsland-universal.app.zip")
        #expect(atomParsed.nightly?.checksumDownloadURL?.absoluteString == "https://github.com/snowykami/neo-blog/releases/download/island-nightly/SHA256SUMS.txt")
        #expect(atomParsed.latestStable?.tagName == "island-v0.2.1")
        #expect(atomParsed.latestStable?.displayVersion == "v0.2.1")
        #expect(atomParsed.latestStable?.zipDownloadURL.absoluteString == "https://github.com/snowykami/neo-blog/releases/download/island-v0.2.1/NeoBlogIsland-universal.app.zip")

        // HTML 搜索回退：过滤预发布后缀（如 -beta.1），准确命中最高正式版标签
        let searchHTML = """
        <a href="/snowykami/neo-blog/releases/tag/island-v0.3.0-beta.1">Beta</a>
        <a href="/snowykami/neo-blog/releases/tag/island-v0.2.0">v0.2.0</a>
        <a href="/snowykami/neo-blog/releases/tag/island-v0.2.3?expanded=true">v0.2.3</a>
        """
        let htmlStable = AppUpdateService.extractLatestStableFromReleasesHTML(searchHTML, repoSlug: "snowykami/neo-blog")
        #expect(htmlStable?.tagName == "island-v0.2.3")
        #expect(htmlStable?.displayVersion == "v0.2.3")

        // 直连构造、固定标签页 HTML 回退与非法 slug 拦截
        let nightlyTagHTML = """
        <html><head><title>Release NeoBlogIsland Nightly (2026-11-18 · 5c6d7e8) · snowykami/neo-blog</title></head>
        <body>
          <relative-time datetime="2026-11-18T06:00:00Z"></relative-time>
          <div class="markdown-body">
            <ul>
              <li><strong>版本标识</strong>：<code>0.2.0-nightly.5c6d7e8</code></li>
              <li><strong>对应提交</strong>：<code>5c6d7e8</code> (<a class="commit-link" href="https://github.com/snowykami/neo-blog/commit/5c6d7e8f90123456789abcdef0123456789abcde"><tt>5c6d7e8</tt></a>)</li>
            </ul>
          </div>
          <a href="/snowykami/neo-blog/releases/tag/island-nightly">island-nightly</a>
        </body></html>
        """
        let htmlNightly = AppUpdateService.parseNightlyReleaseTagHTML(nightlyTagHTML, repoSlug: "snowykami/neo-blog")
        #expect(htmlNightly?.displayVersion == "0.2.0-nightly.5c6d7e8")
        #expect(htmlNightly?.commitSHA == "5c6d7e8f90123456789abcdef0123456789abcde")

        #expect(AppUpdateService.directNightlyReleaseInfo(repoSlug: "../evil") == nil)
        #expect(AppUpdateService.directNightlyReleaseInfo(repoSlug: "owner/..") == nil)
        #expect(AppUpdateService.directStableReleaseInfo(repoSlug: "snowykami/neo-blog", tagName: "island-v0.3.0-rc1") == nil)
        let directNightly = AppUpdateService.directNightlyReleaseInfo(repoSlug: "snowykami/neo-blog")
        #expect(directNightly?.zipDownloadURL.absoluteString == "https://github.com/snowykami/neo-blog/releases/download/island-nightly/NeoBlogIsland-universal.app.zip")
    }

    @MainActor
    @Test("内置音频续播与跨 Mac 声随岛走 / 双屏同显原主机发声仲裁及浏览器重连回收")
    func autonomousTakeoverMultiMacHandoffAndBrowserAdoption() async throws {
        let defaultsNameA = "NeoBlogIslandTest.PeerAutoA.\(UUID().uuidString)"
        let defaultsNameB = "NeoBlogIslandTest.PeerAutoB.\(UUID().uuidString)"
        let defaultsA = UserDefaults(suiteName: defaultsNameA)!
        let defaultsB = UserDefaults(suiteName: defaultsNameB)!
        defer {
            defaultsA.removePersistentDomain(forName: defaultsNameA)
            defaultsB.removePersistentDomain(forName: defaultsNameB)
        }

        let peerA = PeerContinuityService(
            overridePeerId: "mac-host-a",
            overrideDeviceName: "Host MacBook Pro",
            isolatedDefaults: defaultsA
        )
        let peerB = PeerContinuityService(
            overridePeerId: "mac-peer-b",
            overrideDeviceName: "Desk Mac mini",
            isolatedDefaults: defaultsB
        )
        let storeA = IslandStore(startNetworkServices: false, peerService: peerA)
        let storeB = IslandStore(startNetworkServices: false, peerService: peerB)
        defer {
            peerA.stop()
            peerB.stop()
        }

        // 1. 先验证「暂停态关浏览器」绝不自动起播内置音频
        let pausedBrowserId = UUID()
        storeA.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://blog.example.com",
          "track": { "id": 77, "name": "Paused Song", "artists": ["Artist"], "duration_ms": 180000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [] }
        }
        """.utf8), clientId: pausedBrowserId, origin: "https://blog.example.com")
        storeA.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://blog.example.com",
          "visible": true,
          "has_played": true,
          "show_playing": false,
          "is_playing": false,
          "track_id": 77,
          "duration_ms": 180000,
          "position_ms": 12000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: pausedBrowserId, origin: "https://blog.example.com")
        storeA.simulateClientDisconnectForTesting(pausedBrowserId)
        #expect(storeA.isAutonomousMode == false)
        #expect(storeA.nativeAudio.isActive == false)

        // 2. 建立两台 Mac 的本地回环 TCP/AWDL 模拟直连并完成配对
        peerB.startLoopbackForTesting()
        for _ in 0..<40 where peerB.directListeningPort == 0 {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(peerB.directListeningPort > 0)
        peerA.connectLoopbackForTesting(port: peerB.directListeningPort, requestPairingIfUntrusted: true)
        for _ in 0..<40 where peerB.pendingPairRequest == nil {
            try await Task.sleep(for: .milliseconds(25))
        }
        peerB.respondToPairRequest(accept: true)
        for _ in 0..<40 where (!peerA.isConnected || !peerB.isConnected) {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(peerA.isConnected && peerB.isConnected)

        // 3. 主机 A 上的浏览器开始播放曲目 888，随后关闭浏览器标签页 -> 主机 A 无缝接续内置播放
        let browserClientA = UUID()
        storeA.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://blog.example.com",
          "accent_hex": "#38bdf8",
          "chorus": [{"start": 30000, "end": 60000}],
          "track": { "id": 888, "name": "Starry Night", "artists": ["Chisato"], "duration_ms": 240000 },
          "lyrics": {
            "source": "ttml-amll",
            "word_synced": true,
            "instrumental": false,
            "lines": [
              {
                "start": 0,
                "end": 60000,
                "words": [{"text": "Hello ", "start": 0, "end": 20000}, {"text": "World", "start": 20000, "end": 60000}]
              }
            ]
          }
        }
        """.utf8), clientId: browserClientA, origin: "https://blog.example.com")
        storeA.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://blog.example.com",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 888,
          "duration_ms": 240000,
          "position_ms": 42500,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: browserClientA, origin: "https://blog.example.com")

        // 浏览器断联！验证主机 A 进入内置续播，且对端 B 在默认单岛模式下保持隐藏与静音
        storeA.simulateClientDisconnectForTesting(browserClientA)
        for _ in 0..<40 where storeB.autonomousSession == nil {
            try await Task.sleep(for: .milliseconds(25))
        }

        #expect(storeA.isAutonomousMode == true)
        #expect(storeA.shouldDisplayIsland == true)
        #expect(storeA.nativeAudio.isActive == true)
        #expect(storeA.nativeAudio.isPlaying == true)
        #expect(storeA.nativeAudio.activeTrackId == 888)
        #expect(abs(storeA.nativeAudio.lastObservedPositionMs - 42500) < 600)

        #expect(storeB.isAutonomousMode == true)
        #expect(storeB.shouldDisplayIsland == false)
        #expect(storeB.nativeAudio.isActive == false)

        // 4. 单岛跨屏流转（非双屏同显）：把灵动岛从 Mac A 甩到 Mac B ->「声随岛走」！Mac A 立即停声，Mac B 接力出声！
        storeA.handoffToConnectedPeer()
        for _ in 0..<40 where !storeB.nativeAudio.isActive {
            try await Task.sleep(for: .milliseconds(25))
        }

        #expect(storeA.shouldDisplayIsland == false)
        #expect(storeA.nativeAudio.isActive == false)
        #expect(storeB.shouldDisplayIsland == true)
        #expect(storeB.nativeAudio.isActive == true)
        #expect(storeB.nativeAudio.isPlaying == true)
        #expect(storeB.autonomousSession?.audioOwnerPeerId == "mac-peer-b")

        // 5. 开启「多屏幕同显」（mirrorBothMacs）：两台 Mac 同时显示灵动岛，但声音回到原源主机 Mac A 播放！
        storeB.toggleMirrorBothMacs()
        for _ in 0..<40 where !storeA.nativeAudio.isActive {
            try await Task.sleep(for: .milliseconds(25))
        }

        #expect(storeA.displayOwnership == .mirrorBothMacs)
        #expect(storeB.displayOwnership == .mirrorBothMacs)
        #expect(storeA.shouldDisplayIsland == true)
        #expect(storeB.shouldDisplayIsland == true)
        #expect(storeA.nativeAudio.isActive == true)
        #expect(storeA.nativeAudio.isPlaying == true)
        #expect(storeB.nativeAudio.isActive == false)
        #expect(storeA.autonomousSession?.audioOwnerPeerId == "mac-host-a")

        // 6. 在从属同显机 Mac B 上拖动进度条 Seek 到 95_000ms -> 远程遥控原主机 Mac A 同步跳转
        storeB.seek(toMs: 95000)
        for _ in 0..<40 where abs(storeA.nativeAudio.lastObservedPositionMs - 95000) > 500 {
            try await Task.sleep(for: .milliseconds(25))
        }
        #expect(abs(storeA.nativeAudio.lastObservedPositionMs - 95000) < 500)

        // 7. 浏览器重新打开同源页面：先收到 adopt_native_session 指令（此时浏览器未发声，灵动岛绝不断声）；
        // 随后浏览器确认起播，双端立即停掉内置音频并交回浏览器驱动
        var interceptedCommands: [OutgoingCommand] = []
        storeA.onInterceptCommandForTest = { cmd in
            interceptedCommands.append(cmd)
        }
        let reconnectedBrowserId = UUID()
        storeA.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://blog.example.com",
          "visible": false,
          "has_played": false,
          "show_playing": false,
          "is_playing": false,
          "track_id": null,
          "duration_ms": 0,
          "position_ms": 0,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: reconnectedBrowserId, origin: "https://blog.example.com")

        let adoptCmd = interceptedCommands.first(where: { $0.action == "adopt_native_session" })
        #expect(adoptCmd != nil)
        #expect(adoptCmd?.trackId == 888)
        #expect(adoptCmd?.isPlaying == true)
        // 浏览器尚未起播前（如受自动播放策略拦截），原生续播保持不断音
        #expect(storeA.nativeAudio.isActive == true)

        // 浏览器尚未真正出声（仅触发前置 'play' 意图但 audio_playing=false，或受自动播放策略拦截）时，原生续播绝不提前停声
        storeA.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://blog.example.com",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "audio_playing": false,
          "track_id": 888,
          "duration_ms": 240000,
          "position_ms": 0,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: reconnectedBrowserId, origin: "https://blog.example.com")
        #expect(storeA.isAutonomousMode == true)
        #expect(storeA.nativeAudio.isActive == true)

        // 验证 localhost 回环源在单岛跨屏流转时固定由原主机保留音频拉流
        #expect(storeA.computeDesiredAudioOwnerPeerId(sourceHostPeerId: "mac-host-a", origin: "http://localhost:3000") == "mac-host-a")

        // 浏览器实际起播后推送 native_session_adopted
        storeA.ingestTestPayload(Data("""
        {
          "type": "native_session_adopted",
          "origin": "https://blog.example.com",
          "tab_id": "reconnected-tab"
        }
        """.utf8), clientId: reconnectedBrowserId, origin: "https://blog.example.com")
        for _ in 0..<40 where storeB.isAutonomousMode {
            try await Task.sleep(for: .milliseconds(25))
        }

        #expect(storeA.isAutonomousMode == false)
        #expect(storeA.nativeAudio.isActive == false)
        #expect(storeB.isAutonomousMode == false)
        #expect(storeB.nativeAudio.isActive == false)
    }

    @Test("独立歌词解析器：原生解析 TTML 逐字振假名、背景和声与 AI 强调特效叠加")
    func standaloneTTMLAndAnnotationsResolver() {
        let sampleTTML = """
        <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
          <head>
            <metadata>
              <ttm:agent xml:id="v1" type="person"/>
              <ttm:agent xml:id="v2" type="person"/>
            </metadata>
          </head>
          <body>
            <div>
              <p begin="00:01.000" end="00:04.000" ttm:agent="v1">
                <span begin="00:01.000" end="00:02.200" ttm:role="x-ruby"><ruby>花火<rt>はなび</rt></ruby></span>
                <span begin="00:02.200" end="00:04.000">が咲く</span>
                <span ttm:role="x-bg" begin="00:02.500" end="00:04.200">
                  <span begin="00:02.500" end="00:04.200">(きらり)</span>
                </span>
                <span ttm:role="x-translation">烟火绽放</span>
              </p>
              <p begin="00:04.500" end="00:07.000" ttm:agent="v2">
                <span begin="00:04.500" end="00:05.500">Hello</span> <span begin="00:05.500" end="00:07.000">world</span>
              </p>
            </div>
          </body>
        </tt>
        """
        let sampleAnnotations = Data("""
        {
          "status": "ready",
          "font": "serif",
          "intro": "夏夜的序曲",
          "singers": [
            { "id": "v1", "name": "千束", "color": "coral" },
            { "id": "v2", "name": "泷奈", "color": "sky" }
          ],
          "lines": [
            {
              "text": "花火が咲く",
              "occurrence": 0,
              "mood": "bright",
              "phrases": [
                { "text": "花火", "effect": "shimmer", "color": "amber" }
              ]
            }
          ]
        }
        """.utf8)
        let aiTransJSON = Data("""
        {
          "status": "ready",
          "source": "ttml-amll",
          "target_lang": "zh",
          "lines": [
            { "text": "花火が咲く", "occurrence": 0, "bg": false, "translation": "AI：绚烂烟花盛开" }
          ]
        }
        """.utf8)

        // 1) preferNative=true 时保留词源原生翻译；双轨对比（AI + 原生）同时填入 translation 与 secondaryTranslation；英文相邻 span 词间空格保留
        let dualBundle = StandaloneSongResolver.parseTTMLForTesting(
            xml: sampleTTML,
            annotationsJSON: sampleAnnotations,
            primarySlot: TranslationSelectionItem(lang: "zh", preferNative: false),
            primaryTranslationsJSON: aiTransJSON,
            secondarySlot: TranslationSelectionItem(lang: "zh", preferNative: true),
            secondaryTranslationsJSON: aiTransJSON
        )
        #expect(dualBundle.wordSynced == true)
        #expect(dualBundle.font == "serif")
        #expect(dualBundle.intro == "夏夜的序曲")
        #expect(dualBundle.lines.count == 3)
        #expect(dualBundle.lines[2].plainText == "Hello world")
        #expect(dualBundle.lines[2].singerName == "泷奈")

        // 1.5) 独唱曲目虽标有单个 ttm:agent="v1"，不开启多声部色条与胶囊；且原生支持 W3C TTML2 tts:ruby="container" 振假名而不污染正文
        let soloTTML2 = """
        <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling">
          <head><metadata><ttm:agent xml:id="v1" type="person"/></metadata></head>
          <body><div>
            <p begin="00:01.000" end="00:03.500" ttm:agent="v1">
              <span tts:ruby="container"><span tts:ruby="base">明日</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="00:01.000" end="00:01.600">あ</span><span tts:ruby="text" begin="00:01.600" end="00:02.200">した</span></span></span><span begin="00:02.200" end="00:03.500">へ</span>
            </p>
          </div></body>
        </tt>
        """
        let soloBundle = StandaloneSongResolver.parseTTMLForTesting(xml: soloTTML2)
        #expect(soloBundle.lines.count == 1)
        #expect(soloBundle.lines[0].plainText == "明日へ")
        #expect(soloBundle.lines[0].edgeColors == nil)
        #expect(soloBundle.lines[0].singerName == nil)
        #expect(soloBundle.lines[0].words[0].text == "明日")
        #expect(soloBundle.lines[0].words[0].ruby?.map(\.text) == ["あ", "した"])

        let mainLine = dualBundle.lines[0]
        #expect(mainLine.isBackground == false)
        #expect(mainLine.plainText == "花火が咲く")
        #expect(mainLine.singerName == "千束")
        #expect(mainLine.translation == "AI：绚烂烟花盛开")
        #expect(mainLine.secondaryTranslation == "烟火绽放")
        #expect(mainLine.words.first?.ruby?.isEmpty == false)
        #expect(mainLine.emphasis.first?.effect == "shimmer")

        let nativePreferredBundle = StandaloneSongResolver.parseTTMLForTesting(
            xml: sampleTTML,
            annotationsJSON: sampleAnnotations,
            primarySlot: TranslationSelectionItem(lang: "zh", preferNative: true),
            primaryTranslationsJSON: aiTransJSON
        )
        #expect(nativePreferredBundle.lines[0].translation == "烟火绽放")
        #expect(nativePreferredBundle.lines[0].secondaryTranslation == nil)

        let bgLine = dualBundle.lines[1]
        #expect(bgLine.isBackground == true)
        #expect(bgLine.owner == 0)
        #expect(bgLine.plainText == "きらり")

        // 2) 嵌套 <span> 词栈：外层带时间戳 span 包裹内层 x-ruby 子 span 时，外层前后文本不丢时间戳
        let nestedTTML = """
        <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
          <body><div>
            <p begin="00:01.000" end="00:05.000">
              <span begin="00:01.000" end="00:04.000">夜<span begin="00:01.800" end="00:02.800" ttm:role="x-ruby"><ruby>空<rt>ぞら</rt></ruby></span>へ</span>
            </p>
          </div></body>
        </tt>
        """
        let nestedBundle = StandaloneSongResolver.parseTTMLForTesting(xml: nestedTTML)
        #expect(nestedBundle.lines.count == 1)
        #expect(nestedBundle.lines[0].plainText == "夜空へ")
        #expect(nestedBundle.lines[0].words.count == 3)
        #expect(nestedBundle.lines[0].words[0].text == "夜")
        #expect(nestedBundle.lines[0].words[1].text == "空")
        #expect(nestedBundle.lines[0].words[1].ruby?.first?.text == "ぞら")
        #expect(nestedBundle.lines[0].words[2].text == "へ")
        #expect(nestedBundle.lines[0].words[2].start == 1000 && nestedBundle.lines[0].words[2].end == 4000)

        // 3) 含斜杠艺名 K/DA、AC/DC 不被拆碎；pin=ttml 无数据时有序回退至 qq-qrc；内网/localhost HTTP 封面不被强升 https
        let kdaItem = PlaylistTrackItem(
            index: 0,
            id: 901,
            name: "POP/STARS",
            aliases: [],
            titleExtra: nil,
            artists: "K/DA / Madison Beer / (G)I-DLE",
            album: "POP/STARS",
            albumPic: nil,
            durationMs: 191000
        )
        let kdaTrack = StandaloneSongResolver.makeIslandTrack(from: kdaItem)
        #expect(kdaTrack.artists == ["K/DA", "Madison Beer", "(G)I-DLE"])

        let pinFallbackCache = Data("""
        {
          "kind": "ncm",
          "qq": {
            "format": "qrc",
            "lyric": "[1000,2000]Hello(1000,800) World(1800,1200)"
          }
        }
        """.utf8)
        let fallbackLyrics = StandaloneSongResolver.buildBaseLyricsForTesting(cacheJSON: pinFallbackCache, pin: "ttml")
        #expect(fallbackLyrics.source == "qq-qrc")
        #expect(fallbackLyrics.lines.first?.plainText == "Hello World")

        #expect(StandaloneSongResolver.resolveCoverURLForTesting(raw: "http://localhost:3000/a.jpg", origin: "http://localhost:3000") == "http://localhost:3000/a.jpg")
        #expect(StandaloneSongResolver.resolveCoverURLForTesting(raw: "http://192.168.1.20:9000/b.jpg", origin: "http://192.168.1.20:9000") == "http://192.168.1.20:9000/b.jpg")
        #expect(StandaloneSongResolver.resolveCoverURLForTesting(raw: "http://p1.music.126.net/xyz.jpg", origin: "https://blog.example.com") == "https://p1.music.126.net/xyz.jpg?imageView=1&thumbnail=240y240&type=webp")

        // 多行缩进 .ttml2 tts:ruby="container" + 独立 x-bg 回声行提升 + 前置背景人声 above 排序 + spotlights 越界钳位与 notes 时间升序
        let multiLineTtml2 = """
        <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling">
          <body>
            <div>
              <p begin="00:01.000" end="00:03.000">
                <span tts:ruby="container">
                  <span tts:ruby="base">
                    <span begin="00:01.000" end="00:01.500">運</span>
                    <span begin="00:01.500" end="00:02.000">命</span>
                  </span>
                  <span tts:ruby="textContainer">
                    <span tts:ruby="text" begin="00:01.000" end="00:01.500">さだ</span>
                    <span tts:ruby="text" begin="00:01.500" end="00:02.000">め</span>
                  </span>
                </span>
                <span ttm:role="x-bg" begin="00:00.600" end="00:00.950">(<span begin="00:00.600" end="00:00.950">Yeah</span>)</span>
              </p>
              <p begin="00:04.000" end="00:05.500">
                <span ttm:role="x-bg" begin="00:04.000" end="00:05.500">(<span begin="00:04.000" end="00:05.500">Echo only</span>)</span>
              </p>
            </div>
          </body>
        </tt>
        """
        let clampAndSortAnnotations = Data("""
        {
          "spotlights": [{ "text": "運命", "occurrence": 99 }],
          "moments": [
            { "text": "Echo only", "occurrence": 5, "content": "Later note", "source": "ai" },
            { "text": "運命", "occurrence": 0, "content": "Earlier note", "source": "comment", "liked": 42 }
          ]
        }
        """.utf8)
        let parsedTtml2 = StandaloneSongResolver.parseTTMLForTesting(xml: multiLineTtml2, annotationsJSON: clampAndSortAnnotations)
        #expect(parsedTtml2.lines.count == 3)
        // 第 0 行应为前置背景人声（above，owner 指向第 1 行主行）
        #expect(parsedTtml2.lines[0].isBackground == true)
        #expect(parsedTtml2.lines[0].backgroundPosition == "above")
        #expect(parsedTtml2.lines[0].owner == 1)
        #expect(parsedTtml2.lines[0].plainText == "Yeah")
        // 第 1 行主唱词不含换行缩进，且保留分片 ruby 精确起止时间
        #expect(parsedTtml2.lines[1].isBackground == false)
        #expect(parsedTtml2.lines[1].plainText == "運命")
        #expect(parsedTtml2.lines[1].words.first?.ruby == [
            LyricRubyPayload(text: "さだ", start: 1000, end: 1500),
            LyricRubyPayload(text: "め", start: 1500, end: 2000)
        ])
        // 第 2 行独立 x-bg 自动提升为主行（isBackground=false, owner=-1）
        #expect(parsedTtml2.lines[2].isBackground == false)
        #expect(parsedTtml2.lines[2].owner == -1)
        #expect(parsedTtml2.lines[2].plainText == "Echo only")
        // spotlights 越界钳位至 [1]，notes 按 start 升序排列
        #expect(parsedTtml2.spotlights == [1])
        #expect(parsedTtml2.notes.map(\.content) == ["Earlier note", "Later note"])
    }

    @MainActor
    @Test("断联宽限期防抖与音频流失败熔断：宽限期内闪断重连零抢播，连续加载失败自动切歌与熔断暂停")
    func gracePeriodDebounceAndAudioFailureCircuitBreaker() async throws {
        let peer = PeerContinuityService(
            overridePeerId: "mac-solo",
            overrideDeviceName: "Solo Mac",
            isolatedDefaults: UserDefaults(suiteName: "NeoBlogIslandTest.Grace.\(UUID().uuidString)")!
        )
        let store = IslandStore(startNetworkServices: false, peerService: peer)
        store.disconnectTakeoverDelayMs = 80

        let client1 = UUID()
        store.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://blog.example.com",
          "track": { "id": 101, "name": "Song A", "artists": ["Artist"], "duration_ms": 180000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [{"start": 0, "end": 60000, "words": [{"text": "Line A", "start": 0, "end": 60000}]}] }
        }
        """.utf8), clientId: client1, origin: "https://blog.example.com")
        store.ingestTestPayload(Data("""
        {
          "type": "playlist",
          "origin": "https://blog.example.com",
          "complete": true,
          "current_index": 0,
          "tracks": [
            { "index": 0, "id": 101, "name": "Song A", "artists": "Artist", "album": "Album", "duration_ms": 180000 },
            { "index": 1, "id": 102, "name": "Song B", "artists": "Artist", "album": "Album", "duration_ms": 200000 }
          ]
        }
        """.utf8), clientId: client1, origin: "https://blog.example.com")
        store.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://blog.example.com",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 101,
          "duration_ms": 180000,
          "position_ms": 15000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: client1, origin: "https://blog.example.com")

        // 1) 模拟浏览器网络闪断：80ms 宽限期内灵动岛保持显示但尚未启动 AVPlayer；25ms 时浏览器重连发声，立即取消内置接管
        store.simulateClientDisconnectForTesting(client1)
        #expect(store.isAutonomousMode == true)
        #expect(store.shouldDisplayIsland == true)
        #expect(store.nativeAudio.isActive == false)

        try await Task.sleep(for: .milliseconds(25))
        let client2 = UUID()
        store.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://blog.example.com",
          "track": { "id": 101, "name": "Song A", "artists": ["Artist"], "duration_ms": 180000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [{"start": 0, "end": 60000, "words": [{"text": "Line A", "start": 0, "end": 60000}]}] }
        }
        """.utf8), clientId: client2, origin: "https://blog.example.com")
        store.ingestTestPayload(Data("""
        {
          "type": "playlist",
          "origin": "https://blog.example.com",
          "complete": true,
          "current_index": 0,
          "tracks": [
            { "index": 0, "id": 101, "name": "Song A", "artists": "Artist", "album": "Album", "duration_ms": 180000 },
            { "index": 1, "id": 102, "name": "Song B", "artists": "Artist", "album": "Album", "duration_ms": 200000 }
          ]
        }
        """.utf8), clientId: client2, origin: "https://blog.example.com")
        store.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://blog.example.com",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 101,
          "duration_ms": 180000,
          "position_ms": 15200,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: client2, origin: "https://blog.example.com")

        #expect(store.isAutonomousMode == false)
        try await Task.sleep(for: .milliseconds(90))
        #expect(store.nativeAudio.isActive == false)

        // 2) 再次真关闭浏览器并等待超过 80ms 宽限期 -> 启动内置续播
        store.simulateClientDisconnectForTesting(client2)
        for _ in 0..<20 where !store.nativeAudio.isActive {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(store.nativeAudio.isActive == true)
        #expect(store.nativeAudio.activeTrackId == 101)

        // 3) 内置续播态下切换多语言翻译槽位指令生效，且非同源本地标签页不会被 openPlayerPage 误发 adopt_native_session
        var interceptedCommands: [OutgoingCommand] = []
        store.onInterceptCommandForTest = { cmd in
            interceptedCommands.append(cmd)
        }
        let unrelatedDevTab = UUID()
        store.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "http://localhost:3000",
          "visible": false,
          "has_played": false,
          "show_playing": false,
          "is_playing": false,
          "audio_playing": false,
          "track_id": null,
          "duration_ms": 0,
          "position_ms": 0,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: unrelatedDevTab, origin: "http://localhost:3000")
        store.openBlogPlayerPage()
        #expect(!interceptedCommands.contains(where: { $0.action == "adopt_native_session" }))

        store.toggleTranslationLang(lang: "en", preferNative: false, hasDualSources: false)
        #expect(store.preferences.translationSelections.map(\.lang) == ["en"])
        store.resetTranslationLangs()
        #expect(store.preferences.translationSelections.isEmpty)

        // 4) 模拟曲目 101 音频 403/断流失败 -> 自动跳到下一首 102；102 再次失败达到熔断上限 -> 自动暂停防无声空跑歌词
        store.nativeAudio.simulateFailureForTesting()
        #expect(store.track?.id == 102)
        #expect(store.isPlaying == true)

        store.nativeAudio.simulateFailureForTesting()
        #expect(store.isPlaying == false)
        #expect(store.nativeAudio.isPlaying == false)
    }

    @Test("NowPlaying MPMediaItemArtwork 在后台非主线程队列回调时不触发 Swift 6 @MainActor 隔离断言崩溃")
    @MainActor
    func nowPlayingArtworkRequestHandlerSurvivesBackgroundQueueInvocation() async throws {
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: 32,
            pixelsHigh: 32,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        )!
        let srcImage = NSImage(size: CGSize(width: 32, height: 32))
        srcImage.addRepresentation(rep)
        let tiffData = try #require(srcImage.tiffRepresentation)
        let artwork = NativeAudioEngine.makeMediaArtwork(boundsSize: srcImage.size, tiffData: tiffData)

        // 模拟 macOS MediaRemote 在后台 XPC 队列同步拉取封面位图（此前会因隐式 @MainActor 隔离直接 EXC_BREAKPOINT 崩溃）
        let renderedWidth: CGFloat = await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                precondition(!Thread.isMainThread)
                let rendered = artwork.image(at: CGSize(width: 120, height: 120))
                continuation.resume(returning: rendered?.size.width ?? 0)
            }
        }
        #expect(renderedWidth > 0)
    }

    @Test("浏览器关闭瞬间 <audio> 抢先派发 pause 不会阻断内置续播，但用户主动暂停后关页不会误续播")
    @MainActor
    func browserUnloadTeardownPauseRaceAndIntentionalPauseDistinction() async throws {
        // 1) 页面卸载抢跑：播放至 42s 时浏览器先发一帧 is_playing=false（甚至卸载归零 position_ms=0），15ms 后 WS 断开 -> 正常接续且保留 42s 进度
        let store1 = IslandStore(startNetworkServices: false)
        store1.disconnectTakeoverDelayMs = 0
        let tab1 = UUID()
        store1.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://59.110.27.154",
          "track": { "id": 301, "name": "Unload Song", "artists": ["Artist"], "duration_ms": 240000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [{"start": 0, "end": 60000, "words": [{"text": "Hello", "start": 0, "end": 60000}]}] }
        }
        """.utf8), clientId: tab1, origin: "https://59.110.27.154")
        store1.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 301,
          "duration_ms": 240000,
          "position_ms": 42000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: tab1, origin: "https://59.110.27.154")

        // 模拟稳态播放/后台节流标签页已过去 850ms 未发心跳，随后关闭页面触发 <audio> 抢跑 pause（甚至卸载归零 position_ms=0）并在 15ms 后断开 WS
        try await Task.sleep(for: .milliseconds(850))
        store1.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": false,
          "audio_playing": false,
          "track_id": 301,
          "duration_ms": 240000,
          "position_ms": 0,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: tab1, origin: "https://59.110.27.154")
        try await Task.sleep(for: .milliseconds(15))

        store1.simulateClientDisconnectForTesting(tab1)
        #expect(store1.isAutonomousMode == true)
        #expect(store1.nativeAudio.isActive == true)
        #expect(store1.currentPositionMs() >= 42800)

        // 2) 用户通过灵动岛主动点击暂停后立即关闭浏览器 -> 尊重用户暂停意图，不触发内置续播
        let store2 = IslandStore(startNetworkServices: false)
        store2.disconnectTakeoverDelayMs = 0
        let tab2 = UUID()
        store2.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://59.110.27.154",
          "track": { "id": 302, "name": "Paused By Island", "artists": ["Artist"], "duration_ms": 240000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [] }
        }
        """.utf8), clientId: tab2, origin: "https://59.110.27.154")
        store2.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 302,
          "duration_ms": 240000,
          "position_ms": 18000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: tab2, origin: "https://59.110.27.154")

        store2.pause()
        store2.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": false,
          "is_playing": false,
          "track_id": 302,
          "duration_ms": 240000,
          "position_ms": 18020,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: tab2, origin: "https://59.110.27.154")
        store2.simulateClientDisconnectForTesting(tab2)
        #expect(store2.isAutonomousMode == false)
        #expect(store2.nativeAudio.isActive == false)

        // 3) 用户在网页端暂停超过 0.7s 后再关标签页 -> 正常收起，不误续播
        let store3 = IslandStore(startNetworkServices: false)
        store3.disconnectTakeoverDelayMs = 0
        let tab3 = UUID()
        store3.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://59.110.27.154",
          "track": { "id": 303, "name": "Paused On Web", "artists": ["Artist"], "duration_ms": 240000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [] }
        }
        """.utf8), clientId: tab3, origin: "https://59.110.27.154")
        store3.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 303,
          "duration_ms": 240000,
          "position_ms": 25000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: tab3, origin: "https://59.110.27.154")
        store3.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": false,
          "is_playing": false,
          "track_id": 303,
          "duration_ms": 240000,
          "position_ms": 25010,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: tab3, origin: "https://59.110.27.154")
        try await Task.sleep(for: .milliseconds(720))
        store3.simulateClientDisconnectForTesting(tab3)
        #expect(store3.isAutonomousMode == false)
    }

    @Test("跨 Mac 连接旧版灵动岛时断联续播自动召回原主机发声与显示，防止落入无声黑洞")
    @MainActor
    func legacyPeerWithoutAutonomousCapabilityRecallsToSourceHost() async throws {
        let suiteA = "test.peer.legacyA.\(UUID().uuidString)"
        let suiteB = "test.peer.legacyB.\(UUID().uuidString)"
        let defA = UserDefaults(suiteName: suiteA)!
        let defB = UserDefaults(suiteName: suiteB)!
        defer {
            defA.removePersistentDomain(forName: suiteA)
            defB.removePersistentDomain(forName: suiteB)
        }

        let peerA = PeerContinuityService(overridePeerId: "mac-source-new", overrideDeviceName: "Mac A", isolatedDefaults: defA)
        let peerB = PeerContinuityService(overridePeerId: "mac-peer-old", overrideDeviceName: "Mac B", isolatedDefaults: defB)
        let storeA = IslandStore(startNetworkServices: false, peerService: peerA)
        let storeB = IslandStore(startNetworkServices: false, peerService: peerB)
        storeA.disconnectTakeoverDelayMs = 0
        defer {
            peerA.stop()
            peerB.stop()
        }

        peerB.startLoopbackForTesting()
        for _ in 0..<25 where peerB.directListeningPort == 0 {
            try await Task.sleep(for: .milliseconds(20))
        }
        peerA.connectLoopbackForTesting(port: peerB.directListeningPort, requestPairingIfUntrusted: true)
        for _ in 0..<25 where peerB.pendingPairRequest == nil {
            try await Task.sleep(for: .milliseconds(20))
        }
        peerB.respondToPairRequest(accept: true)
        for _ in 0..<25 where !peerA.isConnected || !peerB.isConnected {
            try await Task.sleep(for: .milliseconds(20))
        }
        // 默认新版本握手成功时双方均协商出 supportsAutonomousContinuity == true
        #expect(peerA.peerSupportsAutonomousContinuity == true)
        #expect(peerB.peerSupportsAutonomousContinuity == true)

        // 模拟对端 Mac B 运行旧版本（不支持内置续播），且浏览器在线阶段胶囊已被甩屏到 Mac B
        peerA.setPeerSupportsAutonomousContinuityForTesting(false)
        let localTab = UUID()
        storeA.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://59.110.27.154",
          "track": { "id": 401, "name": "Cross Mac Song", "artists": ["Artist"], "duration_ms": 200000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [] }
        }
        """.utf8), clientId: localTab, origin: "https://59.110.27.154")
        storeA.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 401,
          "duration_ms": 200000,
          "position_ms": 30000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: localTab, origin: "https://59.110.27.154")

        storeA.handoffToConnectedPeer()
        #expect(storeA.isIslandHandedOffToPeer == true)

        // 关闭 Mac A 上的浏览器：因 Mac B 不支持 autonomous_sync，Mac A 自动召回显示权并由本机发声续播
        storeA.simulateClientDisconnectForTesting(localTab)
        for _ in 0..<20 where storeB.activeOwnerPeerId != peerA.localPeerId {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(storeA.isAutonomousMode == true)
        #expect(storeA.isLocalAutonomousAudioOwner == true)
        #expect(storeA.nativeAudio.isActive == true)
        #expect(storeA.isIslandHandedOffToPeer == false)
        #expect(storeA.shouldDisplayIsland == true)
        #expect(storeA.canPortalThrowToPeer == false)
        #expect(storeB.isIslandHandedOffToPeer == true)
    }

    @Test("独立播放器与上次连接缓存回退：冷启动无网络时沿用上次播放模式/音量/歌单/歌词起播，博客开播时自动让渡伴随")
    @MainActor
    func standalonePlayerColdLaunchOfflineFallbackAndCompanionYield() async throws {
        let suite = "NeoBlogIslandTest.StandalonePersist.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("neoblog-lib-\(UUID().uuidString)", isDirectory: true)
        let cacheURL = tempDir.appendingPathComponent("library-cache.json", isDirectory: false)
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: tempDir)
        }

        // 1) 第一次运行：浏览器在线播放并推送歌单、歌词、播放模式(shuffle)、音量(0.62)、悬浮形态与英文翻译偏好
        let lib1 = StandaloneLibraryStore(defaults: defaults, cacheFileURL: cacheURL, networkEnabled: false)
        let store1 = IslandStore(startNetworkServices: false, libraryStore: lib1)
        let browserTab1 = UUID()

        store1.ingestTestPayload(Data("""
        {
          "type": "playlist",
          "origin": "https://59.110.27.154",
          "complete": true,
          "current_index": 0,
          "tracks": [
            { "index": 0, "id": 501, "name": "Cached Song 1", "artists": "Chisato", "album": "Lycoris", "duration_ms": 210000 },
            { "index": 1, "id": 502, "name": "Cached Song 2", "artists": "Takina", "album": "Lycoris", "duration_ms": 195000 }
          ]
        }
        """.utf8), clientId: browserTab1, origin: "https://59.110.27.154")
        store1.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://59.110.27.154",
          "accent_hex": "#f472b6",
          "chorus": [{"start": 60000, "end": 90000}],
          "track": { "id": 501, "name": "Cached Song 1", "artists": ["Chisato"], "duration_ms": 210000 },
          "lyrics": {
            "source": "ttml-amll",
            "word_synced": true,
            "instrumental": false,
            "lines": [{"start": 0, "end": 120000, "words": [{"text": "Offline Cached Line", "start": 0, "end": 120000}]}]
          }
        }
        """.utf8), clientId: browserTab1, origin: "https://59.110.27.154")
        store1.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": false,
          "is_playing": false,
          "play_mode": "shuffle",
          "volume": 0.62,
          "muted": false,
          "track_id": 501,
          "duration_ms": 210000,
          "position_ms": 68000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0),
          "preferences": {
            "show_translation": true,
            "can_toggle_translation": true,
            "translation_selections": [{ "lang": "en", "prefer_native": false }],
            "show_romaji": false,
            "can_toggle_romaji": true,
            "show_lyric_effects": true,
            "show_lyric_moments": false
          },
          "config": {
            "form_mode": "notch",
            "expandable": true,
            "beat_bars": true,
            "chorus_glow": true,
            "hdr": false
          }
        }
        """.utf8), clientId: browserTab1, origin: "https://59.110.27.154")
        await lib1.flushNowForTesting()

        // 2) 第二次冷启动（模拟没有打开任何浏览器，且博客网络暂不可达）：直接从上次连接持久化恢复全部偏好与歌单起播
        #expect(StandaloneSongResolver.normalizeBlogOrigin("59.110.27.154/music?x=1") == "https://59.110.27.154")
        #expect(StandaloneSongResolver.normalizeBlogOrigin("localhost:3000/posts") == "http://localhost:3000")

        let lib2 = StandaloneLibraryStore(defaults: defaults, cacheFileURL: cacheURL, networkEnabled: false)
        let store2 = IslandStore(startNetworkServices: false, libraryStore: lib2)
        #expect(lib2.boundOrigin == "https://59.110.27.154")
        #expect(lib2.playlist.count == 2)
        #expect(store2.playMode == .shuffle)
        #expect(abs(store2.volume - 0.62) < 0.001)
        #expect(store2.config.formMode == .notchMerged)
        #expect(store2.config.hdr == false)
        #expect(store2.preferences.showRomaji == false)
        #expect(store2.preferences.showLyricMoments == false)
        #expect(store2.preferences.translationSelections.map(\.lang) == ["en"])

        store2.startStandalonePlayback(autoPlay: true)
        #expect(store2.isAutonomousMode == true)
        #expect(store2.nativeAudio.isActive == true)
        #expect(store2.track?.id == 501)
        #expect(store2.lyrics.lines.first?.plainText == "Offline Cached Line")
        #expect(abs(store2.currentPositionMs() - 68000) < 600)
        #expect(store2.glow?.color == "#f472b6")
        #expect(store2.glow?.strong == false)
        #expect(store2.shouldDisplayIsland == true)

        // 3) 独立播放期间用户新开一个空闲文章阅读标签页（含残留旧歌 media 与默认 repeat-all state）：既不打断独立播放，也不污染持久化偏好与缓存快照
        var intercepted: [OutgoingCommand] = []
        store2.onInterceptCommandForTest = { cmd in intercepted.append(cmd) }
        let articleTab = UUID()
        store2.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://59.110.27.154",
          "track": { "id": 999, "name": "Stale Idle Song", "artists": ["Other"], "duration_ms": 180000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [] }
        }
        """.utf8), clientId: articleTab, origin: "https://59.110.27.154")
        store2.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": false,
          "has_played": false,
          "show_playing": false,
          "is_playing": false,
          "audio_playing": false,
          "play_mode": "repeat-all",
          "volume": 1.0,
          "track_id": 999,
          "duration_ms": 180000,
          "position_ms": 0,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: articleTab, origin: "https://59.110.27.154")
        #expect(store2.isAutonomousMode == true)
        #expect(store2.nativeAudio.isActive == true)
        #expect(lib2.savedSettings.playMode == .shuffle)
        #expect(abs(lib2.savedSettings.volume - 0.62) < 0.001)
        #expect(lib2.lastTrackSnapshot?.track.id == 501)
        #expect(!intercepted.contains(where: { $0.action == "adopt_native_session" }))

        // 3.5) 模拟整站离线拉流连续失败：自动跳曲至熔断上限后自动回退恢复上次缓存曲目 #501（保留歌词与 68s 进度），且暂停态 Seek 可触发 @Observable 刷新
        store2.nativeAudio.simulateFailureForTesting()
        store2.nativeAudio.simulateFailureForTesting()
        #expect(store2.isPlaying == false)
        #expect(store2.track?.id == 501)
        #expect(store2.lyrics.lines.first?.plainText == "Offline Cached Line")
        #expect(lib2.lastTrackSnapshot?.track.id == 501)
        #expect(lib2.lastPlayedPositionMs >= 68000)

        final class FlagBox: @unchecked Sendable { var didInvalidate = false }
        let flag = FlagBox()
        _ = withObservationTracking {
            store2.currentPositionMs()
        } onChange: {
            flag.didInvalidate = true
        }
        store2.seek(toMs: 112000)
        #expect(flag.didInvalidate == true)
        #expect(abs(store2.currentPositionMs() - 112000) < 10)

        // 4) 当用户在网页端点击播放曲目 502 出声时 -> 灵动岛立即停掉内置音频并自动切为浏览器伴随展示模式
        store2.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://59.110.27.154",
          "track": { "id": 502, "name": "Cached Song 2", "artists": ["Takina"], "duration_ms": 195000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [] }
        }
        """.utf8), clientId: articleTab, origin: "https://59.110.27.154")
        store2.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://59.110.27.154",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "audio_playing": true,
          "track_id": 502,
          "duration_ms": 195000,
          "position_ms": 1200,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: articleTab, origin: "https://59.110.27.154")
        #expect(store2.isAutonomousMode == false)
        #expect(store2.nativeAudio.isActive == false)
        #expect(store2.track?.id == 502)
    }

    @Test("副歌辉光分级与 Web lyricGlowAt 严格对齐：常规句柔和档，聚光灯/强调短语（含 1000ms 最短停留）升为强档")
    func chorusGlowNormalVsStrongTierAlignment() throws {
        let bundle = try JSONDecoder().decode(LyricsBundlePayload.self, from: Data("""
        {
          "source": "ttml",
          "word_synced": true,
          "instrumental": false,
          "spotlights": [1],
          "lines": [
            {
              "start": 60000,
              "end": 65000,
              "mood_hex": "#cfe8ff",
              "words": [{ "start": 60000, "end": 65000, "text": "Normal chorus" }],
              "emphasis": [
                {
                  "from": 0,
                  "to": 0,
                  "start": 62000,
                  "end": 62150,
                  "factor": 0.8,
                  "effect": "bloom",
                  "color_hex": "#fbbf24"
                }
              ]
            },
            {
              "start": 65000,
              "end": 70000,
              "words": [{ "start": 65000, "end": 70000, "text": "Spotlight chorus" }]
            }
          ]
        }
        """.utf8))
        let chorus = [TimeIntervalRange(start: 60000, end: 72000)]

        // 常规副歌句（未进强调短语）：使用行情绪色 #cfe8ff 且 strong == false
        let normal = StageTimelineEngine.chorusGlow(at: 61000, lyrics: bundle, chorusRanges: chorus, enabled: true, accentHex: "#f472b6")
        #expect(normal == IslandGlowPayload(color: "#cfe8ff", strong: false))

        // 短促强调短语（原长 150ms，按 LyricSpecs.emphasisMinMs 延长至 1000ms 停留期 [62000, 63000)）：在 62850ms 仍保持强调色 #fbbf24 与 strong == true，63050ms 回落常规档
        let emph = StageTimelineEngine.chorusGlow(at: 62850, lyrics: bundle, chorusRanges: chorus, enabled: true, accentHex: "#f472b6")
        #expect(emph == IslandGlowPayload(color: "#fbbf24", strong: true))
        let afterEmph = StageTimelineEngine.chorusGlow(at: 63050, lyrics: bundle, chorusRanges: chorus, enabled: true, accentHex: "#f472b6")
        #expect(afterEmph == IslandGlowPayload(color: "#cfe8ff", strong: false))

        // 聚光灯点题句（spotlights 含 index 1）：无行色时回落封面主色且 strong == true
        let spot = StageTimelineEngine.chorusGlow(at: 66000, lyrics: bundle, chorusRanges: chorus, enabled: true, accentHex: "#f472b6")
        #expect(spot == IslandGlowPayload(color: "#f472b6", strong: true))

        // 副歌区间内间奏空白（[70000, 72000)）：柔和档封面主色
        let gap = StageTimelineEngine.chorusGlow(at: 71000, lyrics: bundle, chorusRanges: chorus, enabled: true, accentHex: "#f472b6")
        #expect(gap == IslandGlowPayload(color: "#f472b6", strong: false))

        // 区间右开边界 72000ms：已出副歌，返回 nil
        let out = StageTimelineEngine.chorusGlow(at: 72000, lyrics: bundle, chorusRanges: chorus, enabled: true, accentHex: "#f472b6")
        #expect(out == nil)
    }

    @Test("独立模式四通道逐字音译对齐：假名锚点/音拍均分、中文单字配对、QRC 原生时间片、TTML transliteration 与 AI tokens")
    func standaloneWordByWordRomanizationFourPipelines() throws {
        func makeSyllables(_ s: String) -> [LyricWordPayload] {
            Array(s).enumerated().map { i, ch in
                LyricWordPayload(text: String(ch), start: Double(i * 500), end: Double(i * 500 + 500))
            }
        }
        func groupedRaw(_ text: String, _ roma: String) -> [String]? {
            let words = makeSyllables(text)
            guard let aligned = RomanizationAligner.alignRomanization(roma, words: words) else { return nil }
            return words.indices.map { i in aligned.filter { $0.word == i }.map(\.text).joined() }
        }

        // 1) 启发式假名锚点 + 音拍均分（1:1 对齐 web/src/lib/lyrics/romanization.test.ts）
        #expect(groupedRaw("初めてのルーブルは", "hajimete no ruuburu wa") == ["haji", "me", "te ", "no ", "ruu", "", "bu", "ru ", "wa"])
        #expect(groupedRaw("きっと", "kitto") == ["kit", "", "to"])
        #expect(groupedRaw("きゃく", "kyaku") == ["kya", "", "ku"])
        #expect(groupedRaw("私だけ", "watashi dake") == ["watashi ", "da", "ke"])
        #expect(groupedRaw("出会って", "deatte") == ["de", "at", "", "te"])
        #expect(RomanizationAligner.alignRomanization("a ke", words: makeSyllables("出会け")) == nil)
        #expect(RomanizationAligner.alignRomanization("sayonara", words: makeSyllables("初めての")) == nil)

        // 多音拍汉字等比拆分时长（光 -> hi [500,750), ka [750,1000)）
        let lightWords = makeSyllables("が光散ら")
        let lightAligned = try #require(RomanizationAligner.alignRomanization("ga hi ka ri chi ra", words: lightWords))
        let lightSanitized = RomanizationAligner.sanitizeForPayload(lightAligned).filter { $0.word == 1 }
        #expect(lightSanitized == [
            LyricRomanWordPayload(text: "hi", start: 500, end: 750, word: 1),
            LyricRomanWordPayload(text: "ka", start: 750, end: 1000, word: 1)
        ])

        // 纯汉字拼音 1:1 配对 & 纯拉丁/韩文不误对齐
        #expect(groupedRaw("故事的小黄花", "gù shì de xiǎo huáng huā") == ["gù ", "shì ", "de ", "xiǎo ", "huáng ", "huā"])
        #expect(RomanizationAligner.alignRomanization("gushi de xiao huanghua", words: makeSyllables("故事的小黄花")) == nil)
        #expect(RomanizationAligner.alignRomanization("sa rang", words: makeSyllables("사랑")) == nil)

        // 台湾注音轻声点 `˙` 不被 rubyText 剥掉
        #expect(RomanizationAligner.rubyText("  ˙ㄇㄣ！ ") == "˙ㄇㄣ")

        // 2) QQ 音乐 QRC 原生带时间戳罗马音 + 偏移平移（含 `[start,dur]` 格式解析与 CJK 杂质过滤）
        let qqCache = Data("""
        {
          "kind": "qq",
          "qq": {
            "format": "qrc",
            "lyric": "[20699,603]初(20699,434)め(21133,169)",
            "translation": "[00:20.70]初次",
            "romanization": "[20699,603]ha (20699,19)ji (20718,415)me (21133,169)"
          }
        }
        """.utf8)
        let qqBundle = StandaloneSongResolver.buildBaseLyricsForTesting(
            cacheJSON: qqCache,
            pin: "qq",
            offsets: ["qq-qrc": 100]
        )
        #expect(qqBundle.lines.count == 1)
        #expect(qqBundle.lines[0].romanization == "ha ji me")
        #expect(qqBundle.lines[0].romanizationWords == [
            LyricRomanWordPayload(text: "ha", start: 20799, end: 20818, word: 0),
            LyricRomanWordPayload(text: "ji", start: 20818, end: 21233, word: 0),
            LyricRomanWordPayload(text: "me", start: 21233, end: 21402, word: 1)
        ])

        // 网易云 YRC + `[start,dur]` 格式 yromalrc（含字面量圆括号不被截断）+ 日文叠字符 `々` / `っ+拗音` / 宏长音 `ō` 跨词切分
        #expect(groupedRaw("日々に", "hibi ni") == ["hi", "bi ", "ni"])
        #expect(groupedRaw("めっちゃ", "metcha") == ["met", "", "cha", ""])
        #expect(groupedRaw("思う", "omō") == ["omo", "u"])
        #expect(groupedRaw("追う", "ō") == ["o", "u"])
        #expect(groupedRaw("ストーリー", "sutōrī") == ["su", "tō", "", "rī", ""])

        let ncmJSON = Data("""
        {
          "yrc": { "lyric": "[1000,1500](1000,600,0)君(1600,300,0)の(1900,300,0)名(2200,300,0)(yeah)" },
          "yromalrc": { "lyric": "[1000,1500](1000,1500,0)kimi no na (yeah)" }
        }
        """.utf8)
        let ncmBundle = StandaloneSongResolver.buildBaseLyricsForTesting(cacheJSON: nil, ncmJSON: ncmJSON, pin: "ncm")
        #expect(ncmBundle.lines.first?.words.map(\.text) == ["君", "の", "名", "(yeah)"])
        #expect(ncmBundle.lines.first?.romanization == "kimi no na (yeah)")
        #expect(ncmBundle.lines.first?.romanizationWords == [
            LyricRomanWordPayload(text: "kimi", start: 1000, end: 1600, word: 0),
            LyricRomanWordPayload(text: "no", start: 1600, end: 1900, word: 1),
            LyricRomanWordPayload(text: "na", start: 1900, end: 2200, word: 2),
            LyricRomanWordPayload(text: "yeah", start: 2200, end: 2500, word: 3)
        ])

        // 3) TTML <head><transliterations>（优先选 ja-Latn、忽略假名组，并支持 x-bg 背景音译）
        let ttml = """
        <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
        <head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations>
          <transliteration xml:lang="ja"><text for="L1"><span begin="2.000" end="2.600">ひかり</span></text></transliteration>
          <transliteration xml:lang="ja-Latn">
            <text for="L1"><span begin="2.000" end="2.600">hi ka ri</span> <span begin="2.600" end="2.900">chi</span> <span ttm:role="x-bg"><span begin="1.200" end="1.800">(a ha)</span></span></text>
          </transliteration>
        </transliterations></iTunesMetadata></metadata></head>
        <body><div>
          <p begin="1.200" end="2.900" itunes:key="L1">
            <span begin="2.000" end="2.600">光</span><span begin="2.600" end="2.900">散</span>
            <span ttm:role="x-bg"><span begin="1.200" end="1.800">(あは)</span></span>
          </p>
        </div></body></tt>
        """
        let ttmlBundle = StandaloneSongResolver.parseTTMLForTesting(xml: ttml)
        #expect(ttmlBundle.lines.count == 2)
        let bgLine = ttmlBundle.lines[0]
        let mainLine = ttmlBundle.lines[1]
        #expect(bgLine.isBackground == true)
        #expect(bgLine.romanization == "(a ha)")
        #expect(bgLine.romanizationWords == [
            LyricRomanWordPayload(text: "a", start: 1200, end: 1400, word: 0),
            LyricRomanWordPayload(text: "ha", start: 1400, end: 1800, word: 0)
        ])
        #expect(mainLine.romanization == "hi ka ri chi")
        #expect(mainLine.romanizationWords == [
            LyricRomanWordPayload(text: "hi", start: 2000, end: 2200, word: 0),
            LyricRomanWordPayload(text: "ka", start: 2200, end: 2400, word: 0),
            LyricRomanWordPayload(text: "ri", start: 2400, end: 2600, word: 0),
            LyricRomanWordPayload(text: "chi", start: 2600, end: 2900, word: 1)
        ])

        // 4) 后端 AI 歌词读音 `tokens` 数组 + 同语言自动隐藏（简中目标隐藏普通话/台式注音、保留粤语粤拼；港繁/英文目标显示注音）
        let ttmlMixed = """
        <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
          <p begin="1.000" end="3.000"><span begin="1.000" end="2.000">朋友</span><span begin="2.000" end="2.100">、</span><span begin="2.100" end="3.000">再见！</span></p>
          <p begin="3.500" end="5.000"><span begin="3.500" end="5.000">唔该你</span><span ttm:role="x-roman">m4 goi1 nei5</span><span ttm:role="x-roman">duplicate ignored</span></p>
        </div></body></tt>
        """
        let aiPronJSON = Data("""
        {
          "status": "ready",
          "source": "ttml-amll",
          "lines": [
            {
              "text": "朋友、再见！",
              "occurrence": 0,
              "bg": false,
              "lang": "zh-tw",
              "pronunciation": "ㄆㄥˊ ㄧㄡˇ ˙ㄇㄣ",
              "tokens": ["ㄆㄥˊ ㄧㄡˇ", "˙ㄇㄣ"]
            }
          ]
        }
        """.utf8)
        // 简中目标：隐藏台式注音/普通话拼音，保留粤语粤拼且重复 x-roman 不粘连
        let zhBundle = StandaloneSongResolver.parseTTMLForTesting(
            xml: ttmlMixed,
            primarySlot: TranslationSelectionItem(lang: "zh", preferNative: false),
            pronunciationsJSON: aiPronJSON
        )
        #expect(zhBundle.lines[0].romanization == nil)
        #expect(zhBundle.lines[0].romanizationWords.isEmpty)
        #expect(zhBundle.lines[1].romanization == "m4 goi1 nei5")

        // 港繁目标：隐藏粤语粤拼，保留普通话/台式注音并按 tokens 逐词对齐
        let hkBundle = StandaloneSongResolver.parseTTMLForTesting(
            xml: ttmlMixed,
            primarySlot: TranslationSelectionItem(lang: "zh-hk", preferNative: false),
            pronunciationsJSON: aiPronJSON
        )
        #expect(hkBundle.lines[0].romanization == "ㄆㄥˊ ㄧㄡˇ ˙ㄇㄣ")
        #expect(hkBundle.lines[0].romanizationWords == [
            LyricRomanWordPayload(text: "ㄆㄥˊ ㄧㄡˇ", start: 1000, end: 2000, word: 0),
            LyricRomanWordPayload(text: "˙ㄇㄣ", start: 2100, end: 3000, word: 2)
        ])
        #expect(hkBundle.lines[1].romanization == nil)

        // 粤语书面词行（无口语字与数字声调，但整曲 songLang == "zh-hk"）及外语 `lang: "other"` 不被误判隐藏
        #expect(RomanizationAligner.detectLinePronunciationLang(text: "海闊天空", pron: "hoi fut tin hung", songLang: "zh-hk") == "zh-hk")
        #expect(RomanizationAligner.shouldHideSameLangPronunciation(lineLang: "zh-hk", targetLang: "zh") == false)
        #expect(RomanizationAligner.detectLinePronunciationLang(text: "in a la vie", pron: "ɑ̃ a la vi", songLang: "other") == "other")
        #expect(RomanizationAligner.shouldHideSameLangPronunciation(lineLang: "other", targetLang: "en") == false)
    }

    @Test("AWDL 自动重连状态机：意外闪断退避自愈与双机同显恢复、僵尸心跳摘除、并发互拨防撞、手动断开抑制与失效信任自清")
    @MainActor
    func awdlAutoReconnectHeartbeatDualDialAndManualPause() async throws {
        let suiteA = "NeoBlogIslandTest.AWDLRecA.\(UUID().uuidString)"
        let suiteB = "NeoBlogIslandTest.AWDLRecB.\(UUID().uuidString)"
        let defA = try #require(UserDefaults(suiteName: suiteA))
        let defB = try #require(UserDefaults(suiteName: suiteB))
        defer {
            defA.removePersistentDomain(forName: suiteA)
            defB.removePersistentDomain(forName: suiteB)
        }

        // 故意让发起方 B 的 peerId 字典序大于 A（验证字典序较大方在单边可见时同样能主动发起自动重连，绝不死锁）
        let peerA = PeerContinuityService(overridePeerId: "aaaa1111-0000", overrideDeviceName: "MacBook Pro", isolatedDefaults: defA)
        let peerB = PeerContinuityService(overridePeerId: "zzzz9999-0000", overrideDeviceName: "Mac mini", isolatedDefaults: defB)
        for p in [peerA, peerB] {
            p.pingIntervalSec = 0.07
            p.heartbeatTimeoutSec = 0.34
            p.handshakeTimeoutSec = 0.45
            p.waitingAbortTimeoutSec = 0.20
            p.baseReconnectDelaySec = 0.05
            p.maxReconnectDelaySec = 0.25
            p.secondaryPeerDialLeadSec = 0.04
        }

        let storeA = IslandStore(startNetworkServices: false, peerService: peerA)
        let storeB = IslandStore(startNetworkServices: false, peerService: peerB)
        defer {
            peerA.stop()
            peerB.stop()
        }

        peerA.startLoopbackForTesting()
        peerB.startLoopbackForTesting()
        for _ in 0..<40 where (peerA.directListeningPort == 0 || peerB.directListeningPort == 0) {
            try await Task.sleep(for: .milliseconds(15))
        }
        let portA = peerA.directListeningPort
        let portB = peerB.directListeningPort
        #expect(portA > 0 && portB > 0)

        // 仅在 B 侧注册 A 的直连端点（模拟不对称发现：只有字典序较大的 B 看得到 A），验证首次配对 + 后续闪断自动重连
        peerB.connectLoopbackForTesting(port: portA, expectedPeerId: peerA.localPeerId, requestPairingIfUntrusted: true)
        for _ in 0..<40 where peerA.pendingPairRequest == nil {
            try await Task.sleep(for: .milliseconds(15))
        }
        peerA.respondToPairRequest(accept: true)
        for _ in 0..<40 where (!peerA.isConnected || !peerB.isConnected) {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(peerA.isConnected && peerB.isConnected)

        // Mac A 正在播放并开启「双机同时显示」
        let tabA = UUID()
        storeA.ingestTestPayload(Data("""
        {
          "type": "media",
          "origin": "https://blog.example.com",
          "track": { "id": 701, "name": "AWDL Continuity Track", "artists": ["Chisato"], "duration_ms": 210000 },
          "lyrics": { "source": "ncm-lrc", "word_synced": false, "instrumental": false, "lines": [] }
        }
        """.utf8), clientId: tabA, origin: "https://blog.example.com")
        storeA.ingestTestPayload(Data("""
        {
          "type": "state",
          "origin": "https://blog.example.com",
          "visible": true,
          "has_played": true,
          "show_playing": true,
          "is_playing": true,
          "track_id": 701,
          "duration_ms": 210000,
          "position_ms": 25000,
          "anchor_ms": \(Date().timeIntervalSince1970 * 1000.0)
        }
        """.utf8), clientId: tabA, origin: "https://blog.example.com")
        storeA.toggleMirrorBothMacs()
        for _ in 0..<40 where storeB.displayOwnership != .mirrorBothMacs {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(storeB.shouldDisplayIsland == true)

        // 1) 模拟底层无线闪断：字典序较大的 B 依然自动重连成功，且双机同显与曲目快照自动无缝恢复
        peerB.simulateTransportDropForTesting()
        for _ in 0..<60 where (!peerA.isConnected || !peerB.isConnected || storeB.displayOwnership != .mirrorBothMacs) {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(peerA.isConnected && peerB.isConnected)
        #expect(storeA.displayOwnership == .mirrorBothMacs)
        #expect(storeB.displayOwnership == .mirrorBothMacs)
        #expect(storeB.track?.id == 701)

        // 2) 模拟僵尸连接（对端合盖静默黑洞不回 pong、无 TCP FIN）：双向心跳看门狗自动摘除死连接并在恢复后自动重连
        peerA.simulateRadioBlackholeForTesting(true)
        for _ in 0..<60 where peerB.isConnected {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(peerB.isConnected == false)
        peerA.simulateRadioBlackholeForTesting(false)
        for _ in 0..<60 where (!peerA.isConnected || !peerB.isConnected) {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(peerA.isConnected && peerB.isConnected)

        // 3) 模拟双端同毫秒双向并发互拨撞车（临时拉高退避间隔至 5s，严格证明首次互拨原连接零双杀收敛、不依赖事后重连兜底）
        peerA.registerLoopbackEndpointForTesting(peerId: peerB.localPeerId, port: portB)
        peerA.baseReconnectDelaySec = 5.0
        peerB.baseReconnectDelaySec = 5.0
        peerA.simulateTransportDropForTesting()
        peerB.simulateTransportDropForTesting()
        peerA.connectLoopbackForTesting(port: portB, expectedPeerId: peerB.localPeerId, requestPairingIfUntrusted: false)
        peerB.connectLoopbackForTesting(port: portA, expectedPeerId: peerA.localPeerId, requestPairingIfUntrusted: false)
        for _ in 0..<40 where (!peerA.isConnected || !peerB.isConnected) {
            try await Task.sleep(for: .milliseconds(20))
        }
        try await Task.sleep(for: .milliseconds(100))
        #expect(peerA.isConnected && peerB.isConnected)
        peerA.baseReconnectDelaySec = 0.05
        peerB.baseReconnectDelaySec = 0.05

        // 4) 用户手动点击「断开」：发送 goodbye 使双端同步置 isAutoReconnectPausedByUser = true；
        //    即使对端处于非暂停态后台拨入，也会收到带共享 token 鉴权的未认证 goodbye 并自动进入暂停态停止轮询；
        //    点击「恢复自动重连」即使首轮连接失败，第二轮仍携带恢复意图成功唤醒对端
        peerA.disconnectCurrentPeer(userInitiated: true)
        for _ in 0..<30 where peerB.isConnected {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(peerA.isAutoReconnectPausedByUser == true)
        #expect(peerB.isAutoReconnectPausedByUser == true)

        peerB.triggerBackgroundReconnectForTesting()
        for _ in 0..<40 where !peerB.isAutoReconnectPausedByUser {
            try await Task.sleep(for: .milliseconds(15))
        }
        #expect(peerB.isAutoReconnectPausedByUser == true)
        #expect(peerA.isConnected == false && peerB.isConnected == false)

        peerA.dropNextInboundConnectionOnceForTesting = true
        peerB.resumeAutoReconnect()
        for _ in 0..<60 where (!peerA.isConnected || !peerB.isConnected) {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(peerA.isConnected && peerB.isConnected)
        #expect(peerA.isAutoReconnectPausedByUser == false)
        #expect(peerB.isAutoReconnectPausedByUser == false)

        // 5) 对端执行「清除已信任的配对设备」后：后台静默重连收到拒绝响应，自动清理本地失效 token 停止无效重试
        peerA.unpairAllPeers()
        for _ in 0..<60 where !peerB.trustedTokens.isEmpty {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(peerB.trustedTokens.isEmpty)
        #expect(peerB.isReconnecting == false)
    }

    @Test("六档歌词上浮弹性预设（plush / flow / bouncy / crisp / gentle / cascade）双端 1:1 物理对齐与快切收敛")
    @MainActor
    func sixMotionPresetsPhysicsAndStageSpring() {
        #expect(LyricMotionPreset.allCases.count == 6)
        #expect(LyricSpecs.resolveMotionSprings(motion: "bouncy").position.stiffness == 165)
        #expect(LyricSpecs.resolveMotionSprings(motion: "plush").position.stiffness == 90)
        #expect(LyricSpecs.resolveMotionSprings(motion: "crisp").position.stiffness == 360)
        #expect(LyricSpecs.resolveMotionSprings(motion: "gentle").position.stiffness == 68)
        #expect(LyricSpecs.resolveMotionSprings(motion: "cascade").arcPx == 16.0)

        let rapidPlush = LyricSpecs.resolveMotionSprings(motion: "plush", stepIntervalMs: 220)
        #expect(rapidPlush.position.stiffness > 190)

        let engine = StageSpringEngine()
        let lines: [LyricLinePayload] = [
            LyricLinePayload(start: 0, end: 1500, align: "left", words: [LyricWordPayload(text: "首句焦点", start: 0, end: 1500)]),
            LyricLinePayload(start: 1600, end: 3000, align: "left", words: [LyricWordPayload(text: "左待唱", start: 1600, end: 3000)]),
            LyricLinePayload(start: 3100, end: 4500, isDuet: true, align: "right", words: [LyricWordPayload(text: "右对唱", start: 3100, end: 4500)])
        ]
        let entries: [StageTimelineEntry] = lines.enumerated().map { idx, l in
            .line(IndexedLyricLine(id: "line-\(idx)", index: idx, line: l, singerDots: []))
        }
        let placed = engine.stepLayout(
            entries: entries,
            lines: lines,
            stageHeight: 160,
            showRomaji: false,
            showTranslation: false,
            date: Date(),
            nowMs: 500,
            tState: (active: [0], focus: 0, interlude: nil),
            spot: nil,
            motion: "cascade"
        )
        #expect(placed.count == 3)
        #expect(abs(placed[0].x) < 0.01)
        #expect(abs(placed[0].rotDeg) < 0.01)
        #expect(abs(placed[1].x - 8.0) < 0.05)
        #expect(placed[1].rotDeg > 0.8)
        #expect(abs(placed[2].x - (-16.0)) < 0.05)
        #expect(placed[2].rotDeg < -1.5)
    }

    @Test("24 种舞台粒子场景与节拍钟摆相位（sway / tempoScale / 新场景生成）对齐验证")
    @MainActor
    func testParticleSwayAndNewScenes() throws {
        let rhythm = RhythmEngineContext(
            reliable: true,
            basePeriodMs: 500,
            trains: [
                0: [
                    RhythmPulsePoint(t: 500, a: 1.0),
                    RhythmPulsePoint(t: 1000, a: 1.0),
                    RhythmPulsePoint(t: 1500, a: 1.0)
                ],
                1: [RhythmPulsePoint(t: 500, a: 1.0), RhythmPulsePoint(t: 1500, a: 1.0)],
                2: [RhythmPulsePoint(t: 500, a: 1.0)]
            ]
        )
        let lead = RhythmEngineContext.leadMs
        // 拍点 0 -> -1，中点 -> 0，拍点 1 -> +1，拍点 2 -> -1（C^1 平滑交替）
        #expect(abs((rhythm.particleSway(timeMs: 500 - lead) ?? 0) - (-1.0)) < 1e-6)
        #expect(abs(rhythm.particleSway(timeMs: 750 - lead) ?? 1) < 1e-3)
        #expect(abs((rhythm.particleSway(timeMs: 1000 - lead) ?? 0) - 1.0) < 1e-6)
        #expect(abs((rhythm.particleSway(timeMs: 1500 - lead) ?? 0) - (-1.0)) < 1e-6)
        #expect(RhythmEngineContext.fallback.particleSway(timeMs: 600) == nil)
        #expect(rhythm.particleTempoScale > 1.2)

        let pulses = rhythm.particlePulses(octave: 2, t0: 450, t1: 500)
        #expect(pulses?.map(\.t) == [500])

        let sim = StageParticlesEngine(scale: 0.7, maxParticles: 80)
        let newScenes = ["bokeh", "pixels", "lightning", "lanterns", "embers", "sparkles", "confetti", "meteors", "sparks"]
        for name in newScenes {
            sim.reset()
            #expect(!sim.hasActiveParticles)
            let scene = ResolvedStageScene(name: name, colorHex: nil, sprite: nil)
            // 验证各新增场景均能由 StageSignalsSolver 识别并激活
            let json = #"{"lines":[{"start":0,"end":5000,"scene":"\#(name)","scene_lines":4,"words":[{"text":"舞台","start":0,"end":5000}]}]}"#
            let bundle = try JSONDecoder().decode(LyricsBundlePayload.self, from: Data(json.utf8))
            let snap = StageSignalsSolver.compute(lyrics: bundle, chorusRanges: [], rhythm: rhythm, timeMs: 500)
            #expect(snap.scene == scene)
        }
    }
}
