import AppKit
import SwiftUI

/// 读取当前屏幕的物理刘海（摄像头外壳）尺寸与安全区信息，纯使用 Apple 公开 API
struct ScreenNotchMetrics: Equatable {
    let screenFrame: NSRect
    let hasPhysicalNotch: Bool
    let notchWidth: CGFloat
    let notchHeight: CGFloat
    let menuBarHeight: CGFloat

    static func current(for screen: NSScreen? = NSScreen.main) -> ScreenNotchMetrics {
        guard let screen else {
            return ScreenNotchMetrics(
                screenFrame: NSRect(x: 0, y: 0, width: 1440, height: 900),
                hasPhysicalNotch: false,
                notchWidth: 188,
                notchHeight: 32,
                menuBarHeight: 24
            )
        }

        let topSafeInset = screen.safeAreaInsets.top
        let menuThickness = NSStatusBar.system.thickness
        if topSafeInset > 0,
           let leftAux = screen.auxiliaryTopLeftArea,
           let rightAux = screen.auxiliaryTopRightArea {
            let deadZoneWidth = max(160, rightAux.minX - leftAux.maxX)
            return ScreenNotchMetrics(
                screenFrame: screen.frame,
                hasPhysicalNotch: true,
                notchWidth: deadZoneWidth,
                notchHeight: max(topSafeInset, 32),
                menuBarHeight: topSafeInset
            )
        }

        return ScreenNotchMetrics(
            screenFrame: screen.frame,
            hasPhysicalNotch: false,
            notchWidth: 188, // 模拟刘海模式下的基准宽度
            notchHeight: 32,
            menuBarHeight: max(menuThickness, 24)
        )
    }

    func effectiveUseNotch(mode: IslandFormMode) -> Bool {
        switch mode {
        case .auto: return hasPhysicalNotch
        case .notchMerged: return true
        case .floatingCapsule: return false
        }
    }
}

/// 贴顶刘海融合形状：顶部两侧带切向反圆角（猫耳朵贴边融合），底部为连续平滑圆角；
/// 当 topEarRadius == 0 时退化为圆润胶囊/面板
struct NotchIslandShape: Shape {
    var topEarRadius: CGFloat
    var bottomCornerRadius: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(topEarRadius, bottomCornerRadius) }
        set {
            topEarRadius = newValue.first
            bottomCornerRadius = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        let ear = max(0, min(topEarRadius, rect.height * 0.45))
        let br = max(4, min(bottomCornerRadius, min((rect.width - ear * 2) * 0.5, rect.height * 0.5)))

        if ear < 0.5 {
            return RoundedRectangle(cornerRadius: br, style: .continuous).path(in: rect)
        }

        // 本体区域在左右各缩进 ear，顶部向外弯出与屏幕上边缘相切的反圆角
        let bodyLeft = rect.minX + ear
        let bodyRight = rect.maxX - ear
        let top = rect.minY
        let bottom = rect.maxY

        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: top))
        // 左上反圆角（从屏幕顶边切向转入竖边）
        p.addQuadCurve(
            to: CGPoint(x: bodyLeft, y: top + ear),
            control: CGPoint(x: bodyLeft, y: top)
        )
        // 左竖边至左下圆角
        p.addLine(to: CGPoint(x: bodyLeft, y: bottom - br))
        p.addCurve(
            to: CGPoint(x: bodyLeft + br, y: bottom),
            control1: CGPoint(x: bodyLeft, y: bottom - br * 0.45),
            control2: CGPoint(x: bodyLeft + br * 0.45, y: bottom)
        )
        // 底边至右下圆角
        p.addLine(to: CGPoint(x: bodyRight - br, y: bottom))
        p.addCurve(
            to: CGPoint(x: bodyRight, y: bottom - br),
            control1: CGPoint(x: bodyRight - br * 0.45, y: bottom),
            control2: CGPoint(x: bodyRight, y: bottom - br * 0.45)
        )
        // 右竖边至右上反圆角
        p.addLine(to: CGPoint(x: bodyRight, y: top + ear))
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: top),
            control: CGPoint(x: bodyRight, y: top)
        )
        p.closeSubpath()
        return p
    }
}
