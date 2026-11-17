import Foundation
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

    @Test("多歌手胶囊与聚光灯切句无反向掉帧（修复 pillOffset 双重扣除）及四档 motion 律动预设与快切阻尼保护")
    @MainActor
    func testNoDownwardDipOnSingerPillAndMotionPresets() throws {
        // 1. 验证四档预设与快切阻尼收紧
        let bouncyNormal = LyricSpecs.resolveMotionSprings(motion: "bouncy", stepIntervalMs: 1800)
        let bouncyRapid = LyricSpecs.resolveMotionSprings(motion: "bouncy", stepIntervalMs: 200)
        #expect(bouncyNormal.inactiveScale == 0.94)
        #expect(bouncyRapid.position.stiffness >= bouncyNormal.position.stiffness)
        #expect(bouncyRapid.position.damping > bouncyNormal.position.damping)

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
}
