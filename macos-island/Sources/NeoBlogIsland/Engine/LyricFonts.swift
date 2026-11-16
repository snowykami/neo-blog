import AppKit
import CoreText
import SwiftUI

// MARK: - 1:1 对应 web/src/lib/lyrics/lyric-player.css 的 7 套歌词字体栈与宽度测量

enum LyricFontResolver {
    /// 按 lyric-player.css 的优先级返回原生 NSFont（支持 song / kai / xingkai / fangsong / round / mono / script 及字重）
    static func nsFont(key: String?, size: CGFloat, bold: Bool) -> NSFont {
        let weight: NSFont.Weight = bold ? .heavy : .semibold

        guard let key, !key.isEmpty else {
            return NSFont.systemFont(ofSize: size, weight: weight)
        }

        let candidates: [String]
        switch key {
        case "song":
            candidates = ["Songti SC", "STSong", "Source Han Serif SC", "SimSun"]
        case "kai":
            candidates = ["Kaiti SC", "STKaiti", "LXGW WenKai", "KaiTi"]
        case "xingkai":
            candidates = ["Xingkai SC", "STXingkai", "Zhi Mang Xing", "Kaiti SC"]
        case "fangsong":
            candidates = ["STFangsong", "FangSong", "ZCOOL XiaoWei", "Songti SC"]
        case "round":
            candidates = ["Yuanti SC", "ZCOOL KuaiLe", "Arial Rounded MT Bold"]
        case "mono":
            return NSFont.monospacedSystemFont(ofSize: size, weight: weight)
        case "script":
            candidates = ["Snell Roundhand", "Apple Chancery", "Dancing Script"]
        default:
            return NSFont.systemFont(ofSize: size, weight: weight)
        }

        for family in candidates {
            if let base = NSFont(name: family, size: size) {
                if bold, let boldFace = NSFontManager.shared.convert(base, toHaveTrait: .boldFontMask) as NSFont? {
                    return boldFace
                }
                return base
            }
        }
        return NSFont.systemFont(ofSize: size, weight: weight)
    }

    static func swiftUIFont(key: String?, size: CGFloat, bold: Bool) -> Font {
        Font(nsFont(key: key, size: size, bold: bold))
    }

    /// 精确测量一行歌词中每个词在给定字号与字体下的水平盒模型（供舒适走廊拉紧弦滚动与碎屑粒子发射定位）
    static func measureLineWords(
        line: LyricLinePayload,
        songFont: String?,
        fontSize: CGFloat,
        showEffects: Bool
    ) -> (boxes: [MarqueeWordBox], totalWidth: Double) {
        var boxes: [MarqueeWordBox] = []
        boxes.reserveCapacity(line.words.count)
        var cursor: Double = 0

        for (idx, word) in line.words.enumerated() {
            let emph = showEffects ? line.emphasisForWord(at: idx) : nil
            let fontKey = emph?.font ?? songFont
            let isBold = emph?.styles.contains("bold") == true || emph != nil
            let font = nsFont(key: fontKey, size: fontSize, bold: isBold)
            let w = Double((word.text as NSString).size(withAttributes: [.font: font]).width)
            boxes.append(MarqueeWordBox(left: cursor, width: w))
            cursor += w
        }
        return (boxes, cursor)
    }
}
