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
}
