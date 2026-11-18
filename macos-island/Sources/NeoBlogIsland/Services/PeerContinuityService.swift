import AppKit
import Foundation
import Network
import Observation
import os

enum PortalEdge: String, Codable, Equatable, Sendable {
    case left
    case right

    /// 从一台 Mac 的右边缘推出去时，应从右侧那台 Mac 的左边缘滑入（反之亦然）
    var oppositeOnReceivingMac: PortalEdge {
        switch self {
        case .left: return .right
        case .right: return .left
        }
    }
}

enum PeerDisplayOwnership: String, Codable, Equatable, Sendable {
    /// 只在当前持岛的那台 Mac 上单独显示（拖过去后原机隐藏）
    case singleActiveMac
    /// 两台 Mac 同时镜像显示同一个灵动岛
    case mirrorBothMacs
}

struct DiscoveredPeerMac: Identifiable, Equatable, Sendable {
    let serviceName: String
    var displayName: String
    let endpoint: NWEndpoint
    var isTrusted: Bool

    var id: String { serviceName }
}

struct PendingPairRequest: Equatable, Sendable {
    let connId: UUID
    let peerId: String
    let deviceName: String
}

struct PeerPortalPayload: Codable, Equatable, Sendable {
    let fromEdge: PortalEdge
    let offsetFromTopPt: Double
    let dockedInMenuBar: Bool
    var isExpanded: Bool? = nil
}

struct PeerFullSnapshot: Codable, Sendable {
    let mediaRawJSON: Data?
    let rhythmRawJSON: Data?
    let playlistRawJSON: Data?
    let stateRawJSON: Data?
    var preloadRawJSON: Data? = nil
    let livePositionMs: Double
    let isPlaying: Bool
}

struct PeerWirePacket: Codable, Sendable {
    enum Kind: String, Codable, Sendable {
        case hello
        case pairRequest = "pair_request"
        case pairResponse = "pair_response"
        case goodbye
        case ping
        case pong
        case rawBridgeFrame = "raw_bridge_frame"
        case fullSnapshot = "full_snapshot"
        case remoteCommand = "remote_command"
        case portalPreview = "portal_preview"
        case portalCancel = "portal_cancel"
        case portalThrow = "portal_throw"
        case ownershipUpdate = "ownership_update"
        case autonomousSync = "autonomous_sync"
        case autonomousStatePatch = "autonomous_state_patch"
        case autonomousStop = "autonomous_stop"
    }

    let kind: Kind
    var peerId: String? = nil
    var deviceName: String? = nil
    var pairToken: String? = nil
    var accepted: Bool? = nil
    var manualInitiated: Bool? = nil
    var pingSentUptimeMs: Double? = nil
    var rawBridgeData: Data? = nil
    var livePositionMs: Double? = nil
    var snapshot: PeerFullSnapshot? = nil
    var command: OutgoingCommand? = nil
    var portal: PeerPortalPayload? = nil
    var ownership: PeerDisplayOwnership? = nil
    var activeOwnerPeerId: String? = nil
    var autonomousSession: AutonomousSessionPayload? = nil
    var autonomousStatePatch: AutonomousStatePatchPayload? = nil
    var supportsAutonomousContinuity: Bool? = nil
}

/// 基于 Apple Network.framework (`includePeerToPeer = true` / AWDL `awdl0` + Bonjour `_neoblog._tcp`) 的跨 Mac 点对点直连服务：
/// - 无需两台 Mac 处于同一路由器局域网（直接复用通用控制与 AirDrop 同款蓝牙唤醒 + 5GHz AWDL 无线直连）；
/// - 采用 4 字节大端长度前缀帧封装 JSON，彻底规避 `awdl0` IPv6 链路本地地址下的 HTTP Host 握手兼容问题；
/// - 内置双向防撞指数退避自动重连、双向 RTT 心跳僵尸连接摘除、`NWListener`/`NWBrowser` 故障自愈及系统休眠唤醒快速重连。
@Observable
@MainActor
final class PeerContinuityService {
    static let bonjourServiceType = "_neoblog._tcp"
    private static let localPeerIdKey = "NeoBlogIsland.peer.localId"
    private static let trustedPeersKey = "NeoBlogIsland.peer.trustedTokens"
    private static let maxFrameBytes = 20 * 1024 * 1024
    /// 双向同时拨号竞争窗口（毫秒）：仅在双端创建时间差 < 1s 且认证差 < 2s 内按 peerId 字典序保留唯一连接；其余均视为重连替换
    private static let dualDialTieBreakWindowMs: Double = 2000.0
    private static let dualDialCreationSkewLimitMs: Double = 1000.0

    private enum CloseReason {
        case transportClosed
        case heartbeatTimeout
        case handshakeTimeout
        case remoteManualDisconnect
        case systemSleep
        case superseded
    }

    private final class PeerConnectionBox {
        let id: UUID
        let connection: NWConnection
        let isOutbound: Bool
        let isManualInitiated: Bool
        let outboundEndpoint: NWEndpoint?
        let expectedPeerIdHint: String?
        let createdAtUptimeMs: Double
        var receiveBuffer = Data()
        var remotePeerId: String?
        var remoteDeviceName: String?
        var remoteServiceName: String?
        var isAuthenticated: Bool = false
        var remoteSupportsAutonomousContinuity: Bool = false
        var authenticatedAtUptimeMs: Double = 0
        /// 首轮未获回包的 `.ping` 发出时刻与累计未回包轮数（免疫 macOS App Nap 定时器合并节流导致的假性超时）
        var awaitingPongSinceUptimeMs: Double? = nil
        var unansweredPingCount: Int = 0
        var timeoutTask: Task<Void, Never>?

        init(
            id: UUID,
            connection: NWConnection,
            isOutbound: Bool,
            isManualInitiated: Bool = false,
            outboundEndpoint: NWEndpoint? = nil,
            remoteServiceName: String? = nil,
            expectedPeerIdHint: String? = nil,
            nowUptimeMs: Double
        ) {
            self.id = id
            self.connection = connection
            self.isOutbound = isOutbound
            self.isManualInitiated = isManualInitiated
            self.outboundEndpoint = outboundEndpoint
            self.remoteServiceName = remoteServiceName
            self.expectedPeerIdHint = expectedPeerIdHint
            self.createdAtUptimeMs = nowUptimeMs
        }
    }

    @ObservationIgnored private let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "PeerContinuity")
    @ObservationIgnored private var listener: NWListener?
    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var pathMonitor: NWPathMonitor?
    @ObservationIgnored private var listenerRestartTask: Task<Void, Never>?
    @ObservationIgnored private var browserRestartTask: Task<Void, Never>?
    @ObservationIgnored private var wakeRecoveryTask: Task<Void, Never>?
    @ObservationIgnored private var sleepObserver: NSObjectProtocol?
    @ObservationIgnored private var wakeObserver: NSObjectProtocol?

    @ObservationIgnored private var connections: [UUID: PeerConnectionBox] = [:]
    @ObservationIgnored private var activeConnectionId: UUID? = nil
    @ObservationIgnored private var maintenanceTimer: Timer?
    @ObservationIgnored private var reconnectTask: Task<Void, Never>?

    @ObservationIgnored private var isRunning: Bool = false
    @ObservationIgnored private var isBonjourMode: Bool = false
    @ObservationIgnored private var isSystemSleeping: Bool = false
    /// 用户主动点击「重连 / 恢复自动重连」的持久恢复意图：若首轮因 BLE 唤醒 awdl0 超时，后续退避轮次仍携带恢复标记唤醒暂停对端
    @ObservationIgnored private var pendingUserResumeIntent: Bool = false
    @ObservationIgnored private var lastUnexpectedDisconnectUptimeMs: Double = -1_000_000
    @ObservationIgnored private var lastBrowserRefreshUptimeMs: Double = 0
    @ObservationIgnored private var lastPathSignature: String = ""
    @ObservationIgnored private var lastConnectedPeerId: String? = nil
    @ObservationIgnored private var lastKnownDirectEndpoints: [String: NWEndpoint] = [:]

    // MARK: - 可调重连与保活时序参数（默认生产值，单测可按需缩短加速）

    @ObservationIgnored var pingIntervalSec: TimeInterval = 3.0
    @ObservationIgnored var heartbeatTimeoutSec: TimeInterval = 9.5
    @ObservationIgnored var handshakeTimeoutSec: TimeInterval = 6.0
    @ObservationIgnored var waitingAbortTimeoutSec: TimeInterval = 3.0
    @ObservationIgnored var manualPairApprovalTimeoutSec: TimeInterval = 35.0
    @ObservationIgnored var warmReconnectWindowSec: TimeInterval = 45.0
    @ObservationIgnored var baseReconnectDelaySec: TimeInterval = 0.45
    @ObservationIgnored var maxReconnectDelaySec: TimeInterval = 15.0
    @ObservationIgnored var secondaryPeerDialLeadSec: TimeInterval = 0.9
    @ObservationIgnored var browserStaleRefreshIntervalSec: TimeInterval = 25.0
    /// 模拟单机无线电静默黑洞（如直接合盖断网且无 TCP FIN/RST，丢弃收发帧并拒绝新入站连接）
    @ObservationIgnored private(set) var isRadioBlackholeForTesting: Bool = false
    /// 模拟首轮拨号停留在 `.waiting`（验证跨轮次 `pendingUserResumeIntent` 保持）
    @ObservationIgnored var dropNextInboundConnectionOnceForTesting: Bool = false

    let localPeerId: String
    let localServiceName: String
    let localDeviceName: String

    /// key: remotePeerId, value: 配对共享 token
    private(set) var trustedTokens: [String: String] = [:]
    /// key: remotePeerId, value: 最近一次已知设备名
    private(set) var knownPeerNames: [String: String] = [:]

    private(set) var discoveredPeers: [DiscoveredPeerMac] = []
    private(set) var connectedPeerId: String? = nil
    private(set) var connectedPeerName: String? = nil
    private(set) var peerSupportsAutonomousContinuity: Bool = false
    private(set) var oneWayLatencyMs: Double = 4.0
    private(set) var pendingPairRequest: PendingPairRequest? = nil
    private(set) var isAwaitingRemoteApproval: Bool = false
    private(set) var directListeningPort: UInt16 = 0

    /// 用户主动点击「断开 / 暂停」后置为 true，暂停后台静默重连，直至任一端点击「重连 / 恢复自动重连」
    private(set) var isAutoReconnectPausedByUser: Bool = false
    private(set) var isReconnecting: Bool = false
    private(set) var reconnectAttemptCount: Int = 0
    private(set) var reconnectingPeerName: String? = nil

    var isConnected: Bool { connectedPeerId != nil }

    func setPeerSupportsAutonomousContinuityForTesting(_ supported: Bool) {
        peerSupportsAutonomousContinuity = supported
    }

    func simulateRadioBlackholeForTesting(_ enabled: Bool) {
        isRadioBlackholeForTesting = enabled
    }

    @ObservationIgnored var onPeerAuthenticated: ((String, String) -> Void)?
    @ObservationIgnored var onPeerDisconnected: ((String) -> Void)?
    @ObservationIgnored var onReceiveBridgeFrame: ((Data, Double?) -> Void)?
    @ObservationIgnored var onReceiveFullSnapshot: ((PeerFullSnapshot) -> Void)?
    @ObservationIgnored var onReceiveRemoteCommand: ((OutgoingCommand) -> Void)?
    @ObservationIgnored var onReceivePortalPreview: ((PeerPortalPayload?) -> Void)?
    @ObservationIgnored var onReceivePortalThrow: ((PeerPortalPayload) -> Void)?
    @ObservationIgnored var onReceiveOwnershipUpdate: ((PeerDisplayOwnership, String?) -> Void)?
    @ObservationIgnored var onReceiveAutonomousSync: ((AutonomousSessionPayload) -> Void)?
    @ObservationIgnored var onReceiveAutonomousStatePatch: ((AutonomousStatePatchPayload) -> Void)?
    @ObservationIgnored var onReceiveAutonomousStop: (() -> Void)?

    init(
        overridePeerId: String? = nil,
        overrideDeviceName: String? = nil,
        isolatedDefaults: UserDefaults? = nil
    ) {
        let defaults = isolatedDefaults ?? .standard
        if let overridePeerId {
            self.localPeerId = overridePeerId
        } else if let saved = defaults.string(forKey: Self.localPeerIdKey), !saved.isEmpty {
            self.localPeerId = saved
        } else {
            let fresh = UUID().uuidString.lowercased()
            defaults.set(fresh, forKey: Self.localPeerIdKey)
            self.localPeerId = fresh
        }

        self.localServiceName = Self.serviceName(forPeerId: self.localPeerId)
        self.localDeviceName = overrideDeviceName
            ?? Host.current().localizedName
            ?? ProcessInfo.processInfo.hostName

        if let savedTrust = defaults.dictionary(forKey: Self.trustedPeersKey) as? [String: String] {
            self.trustedTokens = savedTrust
        }
        if let savedNames = defaults.dictionary(forKey: Self.trustedPeersKey + ".names") as? [String: String] {
            self.knownPeerNames = savedNames
        }
        self.backingDefaults = defaults
    }

    @ObservationIgnored private let backingDefaults: UserDefaults

    private static func nowUptimeMs() -> Double {
        ProcessInfo.processInfo.systemUptime * 1000.0
    }

    static func serviceName(forPeerId peerId: String) -> String {
        let cleanHex = peerId.replacingOccurrences(of: "-", with: "").prefix(10)
        return "nb-\(cleanHex)"
    }

    // MARK: - 生命周期：AWDL + Bonjour 广播、扫描、网卡路径与休眠唤醒监听

    func start() {
        guard !isRunning else { return }
        isRunning = true
        isBonjourMode = true
        isSystemSleeping = false
        startBonjourListener()
        startBonjourBrowser()
        startPathAndPowerMonitors()
        restartMaintenanceTimer()
        if !trustedTokens.isEmpty && !isAutoReconnectPausedByUser {
            lastUnexpectedDisconnectUptimeMs = Self.nowUptimeMs()
            scheduleAutoReconnect(resetBackoff: true)
        }
    }

    /// 供单元测试在本地回环端口直接启动（不触发系统本地网络隐私弹窗，完整运行心跳与自动重连状态机）
    func startLoopbackForTesting(fixedPort: UInt16 = 0) {
        isRunning = true
        isBonjourMode = false
        isSystemSleeping = false
        listener?.cancel()
        listener = nil

        let tcp = Self.makeTCPOptions()
        let params = NWParameters(tls: nil, tcp: tcp)
        let endpointPort: NWEndpoint.Port = (fixedPort > 0)
            ? (NWEndpoint.Port(rawValue: fixedPort) ?? .any)
            : .any
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: endpointPort)
        guard let nwListener = try? NWListener(using: params) else { return }

        nwListener.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, self.listener === nwListener else { return }
                if case .ready = state, let port = nwListener.port?.rawValue {
                    self.directListeningPort = port
                }
            }
        }
        nwListener.newConnectionHandler = { [weak self] conn in
            Task { @MainActor in
                self?.acceptInbound(conn)
            }
        }
        self.listener = nwListener
        nwListener.start(queue: .main)
        restartMaintenanceTimer()
    }

    func connectLoopbackForTesting(
        port: UInt16,
        expectedPeerId: String? = nil,
        requestPairingIfUntrusted: Bool = true
    ) {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { return }
        isAutoReconnectPausedByUser = false
        pendingUserResumeIntent = true
        let endpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: nwPort)
        if let expectedPeerId {
            lastKnownDirectEndpoints[expectedPeerId] = endpoint
        }
        openOutboundConnection(
            to: endpoint,
            serviceName: expectedPeerId.map(Self.serviceName(forPeerId:)),
            expectedPeerIdHint: expectedPeerId,
            manualPairRequest: requestPairingIfUntrusted,
            manualInitiated: true,
            useP2PParameters: false
        )
    }

    func registerLoopbackEndpointForTesting(peerId: String, port: UInt16) {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { return }
        lastKnownDirectEndpoints[peerId] = .hostPort(host: .ipv4(.loopback), port: nwPort)
    }

    /// 供单元测试模拟底层无线链路闪断（不发送 `.goodbye`，触发自动重连状态机）
    func simulateTransportDropForTesting() {
        let ids = Array(connections.keys)
        for id in ids {
            closeConnection(id, reason: .transportClosed)
        }
    }

    /// 供单元测试模拟本机处于未连接状态下的后台自动拨号（验证收到对端暂停态鉴权 `.goodbye` 后自动停止轮询）
    func triggerBackgroundReconnectForTesting() {
        isAutoReconnectPausedByUser = false
        pendingUserResumeIntent = false
        lastUnexpectedDisconnectUptimeMs = Self.nowUptimeMs()
        scheduleAutoReconnect(resetBackoff: true)
    }

    func stop() {
        isRunning = false
        isBonjourMode = false
        isSystemSleeping = false
        isRadioBlackholeForTesting = false
        dropNextInboundConnectionOnceForTesting = false
        pendingUserResumeIntent = false
        maintenanceTimer?.invalidate()
        maintenanceTimer = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        listenerRestartTask?.cancel()
        listenerRestartTask = nil
        browserRestartTask?.cancel()
        browserRestartTask = nil
        wakeRecoveryTask?.cancel()
        wakeRecoveryTask = nil
        pathMonitor?.cancel()
        pathMonitor = nil
        if let obs = sleepObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
            sleepObserver = nil
        }
        if let obs = wakeObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
            wakeObserver = nil
        }
        browser?.cancel()
        browser = nil
        listener?.cancel()
        listener = nil
        directListeningPort = 0
        for (_, box) in connections {
            box.timeoutTask?.cancel()
            box.connection.cancel()
        }
        connections.removeAll()
        activeConnectionId = nil
        connectedPeerId = nil
        connectedPeerName = nil
        peerSupportsAutonomousContinuity = false
        pendingPairRequest = nil
        isAwaitingRemoteApproval = false
        isReconnecting = false
        reconnectAttemptCount = 0
        reconnectingPeerName = nil
    }

    private static func makeTCPOptions() -> NWProtocolTCP.Options {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        tcp.enableKeepalive = true
        tcp.keepaliveIdle = 8
        tcp.keepaliveInterval = 3
        tcp.keepaliveCount = 3
        return tcp
    }

    private static func makeP2PParameters() -> NWParameters {
        let params = NWParameters(tls: nil, tcp: makeTCPOptions())
        params.includePeerToPeer = true
        return params
    }

    private static func makeDirectTCPParameters() -> NWParameters {
        NWParameters(tls: nil, tcp: makeTCPOptions())
    }

    private func startBonjourListener() {
        guard isRunning, isBonjourMode, !isSystemSleeping else { return }
        listenerRestartTask?.cancel()
        listener?.cancel()
        listener = nil

        let params = Self.makeP2PParameters()
        guard let nwListener = try? NWListener(using: params) else {
            logger.error("无法创建 AWDL/Bonjour NWListener，稍后自动重试")
            scheduleListenerRestart()
            return
        }
        nwListener.service = NWListener.Service(name: localServiceName, type: Self.bonjourServiceType)
        nwListener.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, self.listener === nwListener else { return }
                switch state {
                case .ready:
                    self.logger.info("AWDL/Bonjour 监听已就绪: \(self.localServiceName, privacy: .public)")
                case .failed(let err):
                    self.logger.warning("AWDL/Bonjour 监听异常，准备自愈重建: \(err.localizedDescription, privacy: .public)")
                    nwListener.cancel()
                    if self.listener === nwListener {
                        self.listener = nil
                    }
                    self.scheduleListenerRestart()
                default:
                    break
                }
            }
        }
        nwListener.newConnectionHandler = { [weak self] conn in
            Task { @MainActor in
                self?.acceptInbound(conn)
            }
        }
        self.listener = nwListener
        nwListener.start(queue: .main)
    }

    private func scheduleListenerRestart() {
        guard isRunning, isBonjourMode, !isSystemSleeping else { return }
        listenerRestartTask?.cancel()
        listenerRestartTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled, let self, self.isRunning, self.isBonjourMode, !self.isSystemSleeping, self.listener == nil else {
                return
            }
            self.startBonjourListener()
        }
    }

    private func startBonjourBrowser() {
        guard isRunning, isBonjourMode, !isSystemSleeping else { return }
        browserRestartTask?.cancel()
        browser?.cancel()
        browser = nil
        lastBrowserRefreshUptimeMs = Self.nowUptimeMs()

        let params = NWParameters()
        params.includePeerToPeer = true
        let nwBrowser = NWBrowser(
            for: .bonjour(type: Self.bonjourServiceType, domain: nil),
            using: params
        )
        nwBrowser.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, self.browser === nwBrowser else { return }
                if case .failed(let err) = state {
                    self.logger.warning("AWDL/Bonjour 扫描器异常，准备自愈重建: \(err.localizedDescription, privacy: .public)")
                    nwBrowser.cancel()
                    if self.browser === nwBrowser {
                        self.browser = nil
                    }
                    self.scheduleBrowserRestart()
                }
            }
        }
        nwBrowser.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                guard let self, self.browser === nwBrowser else { return }
                self.handleBrowseResults(results)
            }
        }
        self.browser = nwBrowser
        nwBrowser.start(queue: .main)
    }

    private func scheduleBrowserRestart() {
        guard isRunning, isBonjourMode, !isSystemSleeping else { return }
        browserRestartTask?.cancel()
        browserRestartTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(1500))
            guard !Task.isCancelled, let self, self.isRunning, self.isBonjourMode, !self.isSystemSleeping, self.browser == nil else {
                return
            }
            self.startBonjourBrowser()
        }
    }

    private func startPathAndPowerMonitors() {
        pathMonitor?.cancel()
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let sig = "\(path.status)|" + path.availableInterfaces.map { "\($0.name):\($0.type)" }.joined(separator: ",")
            let isSatisfied = (path.status == .satisfied)
            Task { @MainActor [weak self] in
                guard let self, self.isRunning, !self.isSystemSleeping else { return }
                guard sig != self.lastPathSignature else { return }
                let hadPrevious = !self.lastPathSignature.isEmpty
                self.lastPathSignature = sig
                guard hadPrevious else { return }

                if self.isBonjourMode {
                    if self.listener == nil { self.startBonjourListener() }
                    if self.browser == nil { self.startBonjourBrowser() }
                }
                if isSatisfied, !self.isConnected, !self.isAutoReconnectPausedByUser, !self.trustedTokens.isEmpty {
                    self.lastUnexpectedDisconnectUptimeMs = Self.nowUptimeMs()
                    self.scheduleAutoReconnect(resetBackoff: true)
                }
            }
        }
        monitor.start(queue: .main)
        self.pathMonitor = monitor

        let wsCenter = NSWorkspace.shared.notificationCenter
        if let obs = sleepObserver { wsCenter.removeObserver(obs) }
        if let obs = wakeObserver { wsCenter.removeObserver(obs) }

        sleepObserver = wsCenter.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleSystemWillSleep()
            }
        }
        wakeObserver = wsCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handleSystemDidWake()
            }
        }
    }

    private func handleSystemWillSleep() {
        guard isRunning else { return }
        isSystemSleeping = true
        reconnectTask?.cancel()
        reconnectTask = nil
        listenerRestartTask?.cancel()
        listenerRestartTask = nil
        browserRestartTask?.cancel()
        browserRestartTask = nil
        wakeRecoveryTask?.cancel()
        wakeRecoveryTask = nil
        isReconnecting = false
        reconnectingPeerName = nil

        if isBonjourMode {
            browser?.cancel()
            browser = nil
            listener?.cancel()
            listener = nil
        }

        let ids = Array(connections.keys)
        for id in ids {
            closeConnection(id, reason: .systemSleep)
        }
    }

    private func handleSystemDidWake() {
        guard isRunning else { return }
        isSystemSleeping = false
        wakeRecoveryTask?.cancel()
        wakeRecoveryTask = Task { @MainActor [weak self] in
            // 留出 600ms 等待 Wi-Fi / 蓝牙 / awdl0 驱动唤醒就绪后重建监听与扫描并立即重连（独立句柄不被旧 browser 错误回调覆盖）
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, self.isRunning, !self.isSystemSleeping else { return }
            if self.isBonjourMode {
                self.startBonjourListener()
                self.startBonjourBrowser()
            }
            if !self.isConnected, !self.isAutoReconnectPausedByUser, !self.trustedTokens.isEmpty {
                self.lastUnexpectedDisconnectUptimeMs = Self.nowUptimeMs()
                self.scheduleAutoReconnect(resetBackoff: true)
            }
        }
    }

    private func restartMaintenanceTimer() {
        maintenanceTimer?.invalidate()
        let interval = max(0.04, pingIntervalSec)
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.runMaintenanceTick()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        maintenanceTimer = timer
    }

    private func runMaintenanceTick() {
        guard isRunning, !isSystemSleeping else { return }
        let nowMs = Self.nowUptimeMs()

        if let peerId = connectedPeerId,
           let activeBox = activeAuthenticatedBox(for: peerId) {
            if let waitStart = activeBox.awaitingPongSinceUptimeMs,
               activeBox.unansweredPingCount >= 2,
               (nowMs - waitStart) > heartbeatTimeoutSec * 1000.0 {
                let silenceMs = Int(nowMs - waitStart)
                logger.warning("AWDL 双向心跳超时 (连续 \(activeBox.unansweredPingCount) 次 ping 共 \(silenceMs)ms 无 pong)，主动摘除僵尸连接并触发自动重连")
                closeConnection(activeBox.id, reason: .heartbeatTimeout)
                return
            }
            sendTrackedPing(on: activeBox, nowMs: nowMs)
            return
        }

        // 仅在断联/唤醒/网卡变更后的热恢复窗口内允许刷新一次未见信任设备的 NWBrowser；热窗口外保持被动监听零额外射频耗电
        let inWarmWindow = (nowMs - lastUnexpectedDisconnectUptimeMs) <= (warmReconnectWindowSec * 1000.0)
        if isBonjourMode,
           inWarmWindow,
           !isAutoReconnectPausedByUser,
           !trustedTokens.isEmpty,
           !discoveredPeers.contains(where: \.isTrusted),
           nowMs - lastBrowserRefreshUptimeMs >= browserStaleRefreshIntervalSec * 1000.0 {
            startBonjourBrowser()
        }

        if reconnectTask == nil {
            scheduleAutoReconnect(resetBackoff: false)
        }
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        let previouslyTrustedVisible = Set(discoveredPeers.filter(\.isTrusted).map(\.serviceName))
        var found: [DiscoveredPeerMac] = []
        for res in results {
            guard case let .service(name, _, _, _) = res.endpoint else { continue }
            guard name != localServiceName, name.hasPrefix("nb-") else { continue }

            let prefixHex = String(name.dropFirst(3))
            let matchedTrustedEntry = trustedTokens.first { key, _ in
                key.replacingOccurrences(of: "-", with: "").hasPrefix(prefixHex)
            }
            let matchedName = knownPeerNames.first { key, _ in
                key.replacingOccurrences(of: "-", with: "").hasPrefix(prefixHex)
            }?.value

            let readable = matchedName ?? "附近的 Mac (\(prefixHex.prefix(4).uppercased()))"
            if !found.contains(where: { $0.serviceName == name }) {
                found.append(
                    DiscoveredPeerMac(
                        serviceName: name,
                        displayName: readable,
                        endpoint: res.endpoint,
                        isTrusted: matchedTrustedEntry != nil
                    )
                )
            }
        }
        found.sort { $0.serviceName < $1.serviceName }
        discoveredPeers = found

        let newlyVisibleTrusted = found.contains { $0.isTrusted && !previouslyTrustedVisible.contains($0.serviceName) }
        if newlyVisibleTrusted && !isConnected && !isAutoReconnectPausedByUser {
            scheduleAutoReconnect(resetBackoff: true)
        } else if !isConnected && !isAutoReconnectPausedByUser && reconnectTask == nil {
            scheduleAutoReconnect(resetBackoff: false)
        }
    }

    // MARK: - 双向防撞 + 指数退避自动重连调度器

    private struct ReconnectCandidate {
        let peerId: String?
        let serviceName: String
        let displayName: String
        let endpoint: NWEndpoint
        let useP2PParameters: Bool
    }

    private func selectReconnectCandidate() -> ReconnectCandidate? {
        let trustedDiscovered = discoveredPeers.filter(\.isTrusted)
        if !trustedDiscovered.isEmpty {
            if let preferredId = lastConnectedPeerId {
                let prefSvc = Self.serviceName(forPeerId: preferredId)
                if let hit = trustedDiscovered.first(where: { $0.serviceName == prefSvc }) {
                    return ReconnectCandidate(
                        peerId: preferredId,
                        serviceName: hit.serviceName,
                        displayName: hit.displayName,
                        endpoint: hit.endpoint,
                        useP2PParameters: true
                    )
                }
            }
            let first = trustedDiscovered[0]
            let matchedPeerId = trustedTokens.keys.first { Self.serviceName(forPeerId: $0) == first.serviceName }
            return ReconnectCandidate(
                peerId: matchedPeerId,
                serviceName: first.serviceName,
                displayName: first.displayName,
                endpoint: first.endpoint,
                useP2PParameters: true
            )
        }

        // 意外断联或唤醒后的热恢复窗口内，即使 Bonjour 浏览列表尚未刷新，也允许按确定性服务名或已知直连端点主动重连
        let inWarmWindow = (Self.nowUptimeMs() - lastUnexpectedDisconnectUptimeMs) <= (warmReconnectWindowSec * 1000.0)
        guard inWarmWindow else { return nil }

        let orderedPeerIds: [String] = {
            var list = trustedTokens.keys.sorted()
            if let last = lastConnectedPeerId, trustedTokens[last] != nil {
                list.removeAll { $0 == last }
                list.insert(last, at: 0)
            }
            return list
        }()

        for peerId in orderedPeerIds {
            let svc = Self.serviceName(forPeerId: peerId)
            let name = knownPeerNames[peerId] ?? "已配对的 Mac"
            if let direct = lastKnownDirectEndpoints[peerId] {
                return ReconnectCandidate(
                    peerId: peerId,
                    serviceName: svc,
                    displayName: name,
                    endpoint: direct,
                    useP2PParameters: false
                )
            }
            if isBonjourMode {
                let endpoint = NWEndpoint.service(name: svc, type: Self.bonjourServiceType, domain: "local.", interface: nil)
                return ReconnectCandidate(
                    peerId: peerId,
                    serviceName: svc,
                    displayName: name,
                    endpoint: endpoint,
                    useP2PParameters: true
                )
            }
        }
        return nil
    }

    private func computeNextReconnectDelaySec(targetServiceName: String) -> TimeInterval {
        let expFactor = pow(2.0, Double(min(reconnectAttemptCount, 6)))
        let rawDelay = min(maxReconnectDelaySec, baseReconnectDelaySec * expFactor)
        let jitterCap = max(0.01, min(0.45, baseReconnectDelaySec * 0.4))
        let jitter = Double.random(in: 0...jitterCap)
        // 首次重连尝试时，字典序较大的一方让出短暂先手窗口避免双端同毫秒互拨；若对方未拨入则照常主动发起，杜绝单向死锁
        let roleLead = (reconnectAttemptCount == 0 && localServiceName > targetServiceName)
            ? secondaryPeerDialLeadSec
            : 0.0
        return rawDelay + jitter + roleLead
    }

    private func scheduleAutoReconnect(resetBackoff: Bool) {
        if resetBackoff {
            reconnectAttemptCount = 0
            reconnectTask?.cancel()
            reconnectTask = nil
        }
        guard isRunning,
              !isSystemSleeping,
              !isConnected,
              !isAutoReconnectPausedByUser,
              !isAwaitingRemoteApproval,
              pendingPairRequest == nil,
              !trustedTokens.isEmpty else {
            isReconnecting = false
            reconnectingPeerName = nil
            return
        }
        guard !connections.values.contains(where: \.isOutbound) else {
            return
        }
        guard reconnectTask == nil else { return }
        guard let candidate = selectReconnectCandidate() else {
            isReconnecting = false
            reconnectingPeerName = nil
            return
        }

        let delaySec = computeNextReconnectDelaySec(targetServiceName: candidate.serviceName)
        isReconnecting = true
        reconnectingPeerName = candidate.displayName

        reconnectTask = Task { @MainActor [weak self] in
            let sleepMs = max(10, Int((delaySec * 1000.0).rounded()))
            try? await Task.sleep(for: .milliseconds(sleepMs))
            guard !Task.isCancelled, let self else { return }
            self.reconnectTask = nil
            self.executeScheduledReconnectAttempt()
        }
    }

    private func executeScheduledReconnectAttempt() {
        guard isRunning,
              !isSystemSleeping,
              !isConnected,
              !isAutoReconnectPausedByUser,
              !isAwaitingRemoteApproval,
              pendingPairRequest == nil else {
            isReconnecting = false
            reconnectingPeerName = nil
            return
        }
        guard !connections.values.contains(where: \.isOutbound) else {
            return
        }
        guard let candidate = selectReconnectCandidate() else {
            isReconnecting = false
            reconnectingPeerName = nil
            return
        }

        reconnectAttemptCount += 1
        isReconnecting = true
        reconnectingPeerName = candidate.displayName
        logger.info("发起 AWDL 自动重连 (第 \(self.reconnectAttemptCount) 次) -> \(candidate.displayName, privacy: .public)")

        openOutboundConnection(
            to: candidate.endpoint,
            serviceName: candidate.serviceName,
            expectedPeerIdHint: candidate.peerId,
            manualPairRequest: false,
            manualInitiated: pendingUserResumeIntent,
            useP2PParameters: candidate.useP2PParameters
        )
    }

    /// 用户点击「立即重连 / 恢复自动重连」时清除手动暂停标记并立刻重连
    func resumeAutoReconnect() {
        isAutoReconnectPausedByUser = false
        pendingUserResumeIntent = true
        lastUnexpectedDisconnectUptimeMs = Self.nowUptimeMs()
        reconnectAttemptCount = 0
        reconnectTask?.cancel()
        reconnectTask = nil

        if let candidate = selectReconnectCandidate() {
            isReconnecting = true
            reconnectingPeerName = candidate.displayName
            reconnectAttemptCount = 1
            openOutboundConnection(
                to: candidate.endpoint,
                serviceName: candidate.serviceName,
                expectedPeerIdHint: candidate.peerId,
                manualPairRequest: false,
                manualInitiated: true,
                useP2PParameters: candidate.useP2PParameters
            )
        } else if isBonjourMode {
            startBonjourBrowser()
        }
    }

    // MARK: - 手动发起配对连接 / 信任审批 / 解除配对

    func connectToDiscoveredPeer(_ peer: DiscoveredPeerMac) {
        isAutoReconnectPausedByUser = false
        pendingUserResumeIntent = true
        reconnectTask?.cancel()
        reconnectTask = nil
        reconnectAttemptCount = 0
        if isConnected {
            disconnectCurrentPeer(userInitiated: false)
        }
        let matchedPeerId = trustedTokens.keys.first { Self.serviceName(forPeerId: $0) == peer.serviceName }
        openOutboundConnection(
            to: peer.endpoint,
            serviceName: peer.serviceName,
            expectedPeerIdHint: matchedPeerId,
            manualPairRequest: !peer.isTrusted,
            manualInitiated: true,
            useP2PParameters: true
        )
    }

    func disconnectCurrentPeer(userInitiated: Bool = true) {
        if userInitiated {
            isAutoReconnectPausedByUser = true
            pendingUserResumeIntent = false
        }
        reconnectTask?.cancel()
        reconnectTask = nil
        isReconnecting = false
        reconnectAttemptCount = 0
        reconnectingPeerName = nil

        let oldId = connectedPeerId
        let existingBoxes = Array(connections.values)
        connections.removeAll()
        activeConnectionId = nil
        connectedPeerId = nil
        connectedPeerName = nil
        peerSupportsAutonomousContinuity = false
        pendingPairRequest = nil
        isAwaitingRemoteApproval = false

        for box in existingBoxes {
            box.timeoutTask?.cancel()
            box.timeoutTask = nil
            if userInitiated && box.isAuthenticated {
                let tok = box.remotePeerId.flatMap { trustedTokens[$0] }
                sendGoodbyeAndCancel(box, pairToken: tok)
            } else {
                box.connection.cancel()
            }
        }

        if let oldId {
            onPeerDisconnected?(oldId)
        }
    }

    private func sendGoodbyeAndCancel(_ box: PeerConnectionBox, pairToken: String?) {
        let packet = PeerWirePacket(kind: .goodbye, peerId: localPeerId, pairToken: pairToken)
        guard !isRadioBlackholeForTesting,
              let json = try? JSONEncoder().encode(packet),
              json.count <= Self.maxFrameBytes else {
            box.connection.cancel()
            return
        }
        let len = UInt32(json.count).bigEndian
        var framed = Data(capacity: 4 + json.count)
        withUnsafeBytes(of: len) { framed.append(contentsOf: $0) }
        framed.append(json)

        let conn = box.connection
        conn.send(content: framed, completion: .contentProcessed { _ in
            conn.cancel()
        })
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(120))
            conn.cancel()
        }
    }

    private func revokeLocalTrust(for peerId: String) {
        guard trustedTokens.removeValue(forKey: peerId) != nil else { return }
        backingDefaults.set(trustedTokens, forKey: Self.trustedPeersKey)
        let targetSvc = Self.serviceName(forPeerId: peerId)
        discoveredPeers = discoveredPeers.map { item in
            guard item.serviceName == targetSvc else { return item }
            var copy = item
            copy.isTrusted = false
            return copy
        }
        if trustedTokens.isEmpty {
            reconnectTask?.cancel()
            reconnectTask = nil
            isReconnecting = false
            reconnectAttemptCount = 0
            reconnectingPeerName = nil
        }
    }

    func unpairAllPeers() {
        trustedTokens.removeAll()
        knownPeerNames.removeAll()
        lastKnownDirectEndpoints.removeAll()
        lastConnectedPeerId = nil
        pendingUserResumeIntent = false
        backingDefaults.removeObject(forKey: Self.trustedPeersKey)
        backingDefaults.removeObject(forKey: Self.trustedPeersKey + ".names")
        disconnectCurrentPeer(userInitiated: false)
        isAutoReconnectPausedByUser = false
        discoveredPeers = discoveredPeers.map { item in
            var copy = item
            copy.isTrusted = false
            return copy
        }
    }

    func respondToPairRequest(accept: Bool) {
        guard let req = pendingPairRequest else { return }
        pendingPairRequest = nil
        guard let box = connections[req.connId] else { return }

        if accept {
            isAutoReconnectPausedByUser = false
            pendingUserResumeIntent = false
            let sharedToken = UUID().uuidString.lowercased()
            saveTrust(peerId: req.peerId, deviceName: req.deviceName, token: sharedToken)
            box.isAuthenticated = true
            // 严格保证 TCP 字节流顺序：先发出 pairResponse 让对端标记 isAuthenticated = true，再触发 onPeerAuthenticated 推送快照
            sendPacket(
                PeerWirePacket(
                    kind: .pairResponse,
                    peerId: localPeerId,
                    deviceName: localDeviceName,
                    pairToken: sharedToken,
                    accepted: true,
                    supportsAutonomousContinuity: true
                ),
                on: box
            )
            promoteAuthenticatedConnection(box, peerId: req.peerId, deviceName: req.deviceName)
        } else {
            sendPacket(
                PeerWirePacket(
                    kind: .pairResponse,
                    peerId: localPeerId,
                    deviceName: localDeviceName,
                    accepted: false
                ),
                on: box
            )
            let id = box.id
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                self?.closeConnection(id, reason: .transportClosed)
            }
        }
    }

    private func saveTrust(peerId: String, deviceName: String, token: String) {
        trustedTokens[peerId] = token
        knownPeerNames[peerId] = deviceName
        backingDefaults.set(trustedTokens, forKey: Self.trustedPeersKey)
        backingDefaults.set(knownPeerNames, forKey: Self.trustedPeersKey + ".names")

        let targetSvc = Self.serviceName(forPeerId: peerId)
        discoveredPeers = discoveredPeers.map { item in
            guard item.serviceName == targetSvc else { return item }
            var copy = item
            copy.displayName = deviceName
            copy.isTrusted = true
            return copy
        }
    }

    // MARK: - 连接建立、握手超时防卡死与 4 字节大端长度帧收发

    private func acceptInbound(_ conn: NWConnection) {
        if isRadioBlackholeForTesting {
            conn.cancel()
            return
        }
        if dropNextInboundConnectionOnceForTesting {
            dropNextInboundConnectionOnceForTesting = false
            conn.cancel()
            return
        }
        let id = UUID()
        let box = PeerConnectionBox(
            id: id,
            connection: conn,
            isOutbound: false,
            nowUptimeMs: Self.nowUptimeMs()
        )
        connections[id] = box
        setupConnectionLifecycle(box, manualPairRequest: false)
    }

    private func openOutboundConnection(
        to endpoint: NWEndpoint,
        serviceName: String?,
        expectedPeerIdHint: String?,
        manualPairRequest: Bool,
        manualInitiated: Bool,
        useP2PParameters: Bool
    ) {
        let staleOutboundIds = connections.values
            .filter { $0.isOutbound && !$0.isAuthenticated }
            .map(\.id)
        for staleId in staleOutboundIds {
            if let removed = connections.removeValue(forKey: staleId) {
                removed.timeoutTask?.cancel()
                removed.connection.cancel()
            }
        }

        let params = useP2PParameters ? Self.makeP2PParameters() : Self.makeDirectTCPParameters()
        let conn = NWConnection(to: endpoint, using: params)
        let id = UUID()
        let box = PeerConnectionBox(
            id: id,
            connection: conn,
            isOutbound: true,
            isManualInitiated: manualInitiated,
            outboundEndpoint: endpoint,
            remoteServiceName: serviceName,
            expectedPeerIdHint: expectedPeerIdHint,
            nowUptimeMs: Self.nowUptimeMs()
        )
        connections[id] = box
        if manualPairRequest {
            isAwaitingRemoteApproval = true
        }
        setupConnectionLifecycle(box, manualPairRequest: manualPairRequest)
    }

    private func armConnectionHandshakeTimeout(_ box: PeerConnectionBox, timeoutSec: TimeInterval) {
        box.timeoutTask?.cancel()
        let connId = box.id
        let ms = max(30, Int((timeoutSec * 1000.0).rounded()))
        box.timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(ms))
            guard !Task.isCancelled,
                  let self,
                  let active = self.connections[connId],
                  !active.isAuthenticated else {
                return
            }
            if self.pendingPairRequest?.connId == connId {
                return
            }
            self.logger.debug("跨机连接握手/建连超时 (\(connId, privacy: .public))，回收连接进入退避重试")
            self.closeConnection(connId, reason: .handshakeTimeout)
        }
    }

    private func isTargetAlreadySatisfiedByActiveConnection(_ box: PeerConnectionBox) -> Bool {
        guard let activePeer = connectedPeerId,
              let activeBox = activeAuthenticatedBox(for: activePeer) else {
            return false
        }
        let matchesPeer = (box.expectedPeerIdHint == activePeer)
            || (box.remoteServiceName != nil && box.remoteServiceName == Self.serviceName(forPeerId: activePeer))
        guard matchesPeer else { return false }
        let ageMs = Self.nowUptimeMs() - activeBox.authenticatedAtUptimeMs
        let activeIsPreferred = (activeBox.isOutbound == (localPeerId < activePeer))
        return activeIsPreferred || ageMs >= 600.0
    }

    private func setupConnectionLifecycle(_ box: PeerConnectionBox, manualPairRequest: Bool) {
        let connId = box.id
        let initialTimeout = manualPairRequest ? manualPairApprovalTimeoutSec : handshakeTimeoutSec
        armConnectionHandshakeTimeout(box, timeoutSec: initialTimeout)

        box.connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, let currentBox = self.connections[connId] else { return }
                switch state {
                case .ready:
                    if currentBox.isOutbound {
                        if !currentBox.isManualInitiated && self.isTargetAlreadySatisfiedByActiveConnection(currentBox) {
                            self.closeConnection(connId, reason: .superseded)
                            return
                        }
                        self.sendOutboundHello(on: currentBox, manualPairRequest: manualPairRequest)
                    }
                case .waiting:
                    if currentBox.isOutbound && !manualPairRequest && !currentBox.isAuthenticated {
                        self.armConnectionHandshakeTimeout(
                            currentBox,
                            timeoutSec: min(self.waitingAbortTimeoutSec, self.handshakeTimeoutSec)
                        )
                    }
                case .failed, .cancelled:
                    self.closeConnection(connId, reason: .transportClosed)
                default:
                    break
                }
            }
        }
        box.connection.start(queue: .main)
        readLoop(connId: connId)
    }

    private func sendOutboundHello(on box: PeerConnectionBox, manualPairRequest: Bool) {
        var matchedToken: String? = nil
        if let hintId = box.expectedPeerIdHint, let tok = trustedTokens[hintId] {
            matchedToken = tok
        } else if let svc = box.remoteServiceName, svc.hasPrefix("nb-") {
            let prefixHex = String(svc.dropFirst(3))
            matchedToken = trustedTokens.first { key, _ in
                key.replacingOccurrences(of: "-", with: "").hasPrefix(prefixHex)
            }?.value
        } else if trustedTokens.count == 1 {
            matchedToken = trustedTokens.values.first
        }

        let carriesResumeIntent = box.isManualInitiated || pendingUserResumeIntent
        if let token = matchedToken {
            sendPacket(
                PeerWirePacket(
                    kind: .hello,
                    peerId: localPeerId,
                    deviceName: localDeviceName,
                    pairToken: token,
                    manualInitiated: carriesResumeIntent ? true : nil,
                    supportsAutonomousContinuity: true
                ),
                on: box
            )
        } else if manualPairRequest {
            armConnectionHandshakeTimeout(box, timeoutSec: manualPairApprovalTimeoutSec)
            sendPacket(
                PeerWirePacket(
                    kind: .pairRequest,
                    peerId: localPeerId,
                    deviceName: localDeviceName,
                    manualInitiated: true,
                    supportsAutonomousContinuity: true
                ),
                on: box
            )
        } else {
            closeConnection(box.id, reason: .handshakeTimeout)
        }
    }

    private func readLoop(connId: UUID) {
        guard let box = connections[connId] else { return }
        box.connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            Task { @MainActor in
                guard let self, let activeBox = self.connections[connId] else { return }
                if let data, !data.isEmpty {
                    if !self.isRadioBlackholeForTesting {
                        activeBox.receiveBuffer.append(data)
                        if !self.drainFrames(on: activeBox) {
                            self.closeConnection(connId, reason: .transportClosed)
                            return
                        }
                    }
                }
                if error != nil || isComplete {
                    self.closeConnection(connId, reason: .transportClosed)
                } else if self.connections[connId] != nil {
                    self.readLoop(connId: connId)
                }
            }
        }
    }

    private func drainFrames(on box: PeerConnectionBox) -> Bool {
        while box.receiveBuffer.count >= 4 {
            let b0 = UInt32(box.receiveBuffer[box.receiveBuffer.startIndex])
            let b1 = UInt32(box.receiveBuffer[box.receiveBuffer.startIndex + 1])
            let b2 = UInt32(box.receiveBuffer[box.receiveBuffer.startIndex + 2])
            let b3 = UInt32(box.receiveBuffer[box.receiveBuffer.startIndex + 3])
            let frameLen = Int((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)

            if frameLen <= 0 || frameLen > Self.maxFrameBytes {
                logger.error("收到非法跨机帧长度: \(frameLen)")
                return false
            }
            guard box.receiveBuffer.count >= 4 + frameLen else {
                return true
            }
            let payloadStart = box.receiveBuffer.startIndex + 4
            let payloadEnd = payloadStart + frameLen
            let frameData = Data(box.receiveBuffer[payloadStart..<payloadEnd])
            box.receiveBuffer.removeSubrange(box.receiveBuffer.startIndex..<payloadEnd)

            if let packet = try? JSONDecoder().decode(PeerWirePacket.self, from: frameData) {
                handlePacket(packet, from: box)
                if connections[box.id] == nil {
                    return true
                }
            }
        }
        return true
    }

    private func sendPacket(_ packet: PeerWirePacket, on box: PeerConnectionBox) {
        guard !isRadioBlackholeForTesting else { return }
        guard let json = try? JSONEncoder().encode(packet), json.count <= Self.maxFrameBytes else { return }
        let len = UInt32(json.count).bigEndian
        var framed = Data(capacity: 4 + json.count)
        withUnsafeBytes(of: len) { framed.append(contentsOf: $0) }
        framed.append(json)
        box.connection.send(content: framed, completion: .idempotent)
    }

    private func activeAuthenticatedBox(for peerId: String) -> PeerConnectionBox? {
        if let activeId = activeConnectionId,
           let box = connections[activeId],
           box.isAuthenticated,
           box.remotePeerId == peerId {
            return box
        }
        return connections.values.first { $0.isAuthenticated && $0.remotePeerId == peerId }
    }

    private func sendToActivePeer(_ packet: PeerWirePacket) {
        guard let peerId = connectedPeerId,
              let box = activeAuthenticatedBox(for: peerId) else {
            return
        }
        sendPacket(packet, on: box)
    }

    private func closeConnection(_ connId: UUID, reason: CloseReason) {
        guard let removed = connections.removeValue(forKey: connId) else { return }
        removed.timeoutTask?.cancel()
        removed.timeoutTask = nil
        removed.connection.cancel()

        let wasAwaitingApproval = removed.isOutbound && isAwaitingRemoteApproval
        if pendingPairRequest?.connId == connId {
            pendingPairRequest = nil
        }
        if removed.isOutbound {
            isAwaitingRemoteApproval = false
        }
        if wasAwaitingApproval && reason == .handshakeTimeout {
            pendingUserResumeIntent = false
        }

        var didLoseActivePeer = false
        if let rId = removed.remotePeerId, connectedPeerId == rId {
            if let remaining = connections.values.first(where: { $0.isAuthenticated && $0.remotePeerId == rId }) {
                activeConnectionId = remaining.id
                peerSupportsAutonomousContinuity = remaining.remoteSupportsAutonomousContinuity
            } else {
                activeConnectionId = nil
                connectedPeerId = nil
                connectedPeerName = nil
                peerSupportsAutonomousContinuity = false
                didLoseActivePeer = true
                onPeerDisconnected?(rId)
            }
        }

        switch reason {
        case .remoteManualDisconnect, .systemSleep:
            if !connections.values.contains(where: \.isOutbound) {
                isReconnecting = false
                reconnectingPeerName = nil
            }
        case .superseded:
            break
        case .handshakeTimeout where wasAwaitingApproval:
            if !connections.values.contains(where: \.isOutbound) {
                isReconnecting = false
                reconnectingPeerName = nil
            }
        case .transportClosed, .heartbeatTimeout, .handshakeTimeout:
            if didLoseActivePeer {
                lastUnexpectedDisconnectUptimeMs = Self.nowUptimeMs()
                reconnectAttemptCount = 0
            }
            if isRunning && !isSystemSleeping && !isConnected && !isAutoReconnectPausedByUser {
                scheduleAutoReconnect(resetBackoff: didLoseActivePeer)
            }
        }
    }

    private func promoteAuthenticatedConnection(_ box: PeerConnectionBox, peerId: String, deviceName: String) {
        let nowMs = Self.nowUptimeMs()
        box.timeoutTask?.cancel()
        box.timeoutTask = nil
        box.remotePeerId = peerId
        box.remoteDeviceName = deviceName
        box.isAuthenticated = true
        box.authenticatedAtUptimeMs = nowMs
        box.awaitingPongSinceUptimeMs = nil
        box.unansweredPingCount = 0
        isAwaitingRemoteApproval = false
        pendingUserResumeIntent = false

        if box.isOutbound, let ep = box.outboundEndpoint, case .hostPort = ep {
            lastKnownDirectEndpoints[peerId] = ep
        }

        let targetSvc = Self.serviceName(forPeerId: peerId)
        let localPrefersOutbound = (localPeerId < peerId)

        // 处理同一对端并存连接：
        // - 当双端反向互拨创建时间差 < 1s 且旧连接刚建立 < 2s 时，按 `localPeerId < peerId` 对称保留唯一优胜连接；
        // - 注意：若本机为 `localPrefersOutbound == true` 且先收到对端入站 `.hello`，绝不能提前掐断 1s 内刚发出的优胜在途出站连接（等待其收到回包平滑接管），防止双杀；
        // - 其余超过 1s 的陈旧卡死连接或断联后重连一律由新连接替换。
        let candidateDupes = connections.values.filter { other in
            guard other.id != box.id else { return false }
            if other.remotePeerId == peerId { return true }
            if !other.isAuthenticated && other.isOutbound {
                let matchesTarget = other.expectedPeerIdHint == peerId || other.remoteServiceName == targetSvc
                guard matchesTarget else { return false }
                return !localPrefersOutbound || (nowMs - other.createdAtUptimeMs) >= Self.dualDialCreationSkewLimitMs
            }
            return false
        }

        for other in candidateDupes {
            let isTrueSimultaneousDualDial = other.isAuthenticated
                && other.isOutbound != box.isOutbound
                && abs(box.createdAtUptimeMs - other.createdAtUptimeMs) < Self.dualDialCreationSkewLimitMs
                && (nowMs - other.authenticatedAtUptimeMs) < Self.dualDialTieBreakWindowMs
            if isTrueSimultaneousDualDial {
                let otherIsPreferred = (other.isOutbound == localPrefersOutbound)
                let newIsPreferred = (box.isOutbound == localPrefersOutbound)
                if otherIsPreferred && !newIsPreferred {
                    closeConnection(box.id, reason: .superseded)
                    return
                }
            }
            if let dup = connections.removeValue(forKey: other.id) {
                dup.timeoutTask?.cancel()
                dup.timeoutTask = nil
                dup.connection.cancel()
            }
        }

        let wasSameActiveBox = (activeConnectionId == box.id && connectedPeerId == peerId)
        activeConnectionId = box.id
        lastConnectedPeerId = peerId
        connectedPeerId = peerId
        connectedPeerName = deviceName
        peerSupportsAutonomousContinuity = box.remoteSupportsAutonomousContinuity

        reconnectTask?.cancel()
        reconnectTask = nil
        isReconnecting = false
        reconnectAttemptCount = 0
        reconnectingPeerName = nil

        if !wasSameActiveBox {
            logger.info("已与跨屏 Mac 建立 AWDL 直连: \(deviceName, privacy: .public)")
            onPeerAuthenticated?(peerId, deviceName)
        }
        sendPingIfConnected()
    }

    // MARK: - 协议报文状态机

    private func handlePacket(_ packet: PeerWirePacket, from box: PeerConnectionBox) {
        switch packet.kind {
        case .hello:
            guard let peerId = packet.peerId, peerId != localPeerId else {
                closeConnection(box.id, reason: .handshakeTimeout)
                return
            }
            box.remoteSupportsAutonomousContinuity = (packet.supportsAutonomousContinuity == true)
            let devName = packet.deviceName ?? "Mac"

            if let expectedToken = trustedTokens[peerId],
               let provided = packet.pairToken,
               provided == expectedToken {
                if packet.manualInitiated == true {
                    isAutoReconnectPausedByUser = false
                } else if isAutoReconnectPausedByUser && !box.isOutbound {
                    // 本机处于手动暂停态：回发携带共享 token 鉴权的 goodbye，使未完成握手的对端也能安全同步进入暂停态停止轮询
                    if let removed = connections.removeValue(forKey: box.id) {
                        removed.timeoutTask?.cancel()
                        removed.timeoutTask = nil
                    }
                    sendGoodbyeAndCancel(box, pairToken: expectedToken)
                    return
                }

                saveTrust(peerId: peerId, deviceName: devName, token: expectedToken)
                let wasAlreadyAuth = box.isAuthenticated
                if !wasAlreadyAuth && !box.isOutbound {
                    sendPacket(
                        PeerWirePacket(
                            kind: .hello,
                            peerId: localPeerId,
                            deviceName: localDeviceName,
                            pairToken: expectedToken,
                            supportsAutonomousContinuity: true
                        ),
                        on: box
                    )
                }
                promoteAuthenticatedConnection(box, peerId: peerId, deviceName: devName)
            } else if box.isOutbound {
                if box.isManualInitiated {
                    armConnectionHandshakeTimeout(box, timeoutSec: manualPairApprovalTimeoutSec)
                    sendPacket(
                        PeerWirePacket(
                            kind: .pairRequest,
                            peerId: localPeerId,
                            deviceName: localDeviceName,
                            manualInitiated: true,
                            supportsAutonomousContinuity: true
                        ),
                        on: box
                    )
                    isAwaitingRemoteApproval = true
                } else {
                    revokeLocalTrust(for: peerId)
                    closeConnection(box.id, reason: .remoteManualDisconnect)
                }
            } else {
                // 对端持旧/失效 token 连入：若为对端手动点击连接则弹出确认并通知对端进入等待审批态；否则回告拒绝使对端自动清理失效 token
                if packet.manualInitiated == true {
                    box.timeoutTask?.cancel()
                    box.remotePeerId = peerId
                    box.remoteDeviceName = devName
                    pendingPairRequest = PendingPairRequest(connId: box.id, peerId: peerId, deviceName: devName)
                    sendPacket(
                        PeerWirePacket(
                            kind: .pairRequest,
                            peerId: localPeerId,
                            deviceName: localDeviceName
                        ),
                        on: box
                    )
                } else {
                    sendPacket(
                        PeerWirePacket(
                            kind: .pairResponse,
                            peerId: localPeerId,
                            deviceName: localDeviceName,
                            accepted: false
                        ),
                        on: box
                    )
                    let id = box.id
                    Task { @MainActor [weak self] in
                        try? await Task.sleep(for: .milliseconds(80))
                        self?.closeConnection(id, reason: .remoteManualDisconnect)
                    }
                }
            }

        case .pairRequest:
            guard let peerId = packet.peerId, peerId != localPeerId else {
                closeConnection(box.id, reason: .handshakeTimeout)
                return
            }
            if box.isOutbound {
                isAwaitingRemoteApproval = true
                armConnectionHandshakeTimeout(box, timeoutSec: manualPairApprovalTimeoutSec)
                return
            }
            box.timeoutTask?.cancel()
            box.remoteSupportsAutonomousContinuity = (packet.supportsAutonomousContinuity == true)
            let devName = packet.deviceName ?? "附近的 Mac"
            box.remotePeerId = peerId
            box.remoteDeviceName = devName
            pendingPairRequest = PendingPairRequest(connId: box.id, peerId: peerId, deviceName: devName)

        case .pairResponse:
            isAwaitingRemoteApproval = false
            guard packet.accepted == true,
                  let peerId = packet.peerId,
                  let token = packet.pairToken else {
                pendingUserResumeIntent = false
                if let rejectedPeerId = packet.peerId {
                    revokeLocalTrust(for: rejectedPeerId)
                }
                closeConnection(box.id, reason: .remoteManualDisconnect)
                return
            }
            isAutoReconnectPausedByUser = false
            pendingUserResumeIntent = false
            box.remoteSupportsAutonomousContinuity = (packet.supportsAutonomousContinuity == true)
            let devName = packet.deviceName ?? "Mac"
            saveTrust(peerId: peerId, deviceName: devName, token: token)
            promoteAuthenticatedConnection(box, peerId: peerId, deviceName: devName)

        case .goodbye:
            let validUnauthOutboundGoodbye: Bool = {
                guard box.isOutbound,
                      let rId = packet.peerId,
                      let expected = trustedTokens[rId],
                      let provided = packet.pairToken else {
                    return false
                }
                return expected == provided
            }()
            guard box.isAuthenticated || validUnauthOutboundGoodbye else { return }
            isAutoReconnectPausedByUser = true
            pendingUserResumeIntent = false
            reconnectTask?.cancel()
            reconnectTask = nil
            isReconnecting = false
            reconnectAttemptCount = 0
            reconnectingPeerName = nil
            closeConnection(box.id, reason: .remoteManualDisconnect)

        case .ping:
            guard box.isAuthenticated else { return }
            sendPacket(PeerWirePacket(kind: .pong, pingSentUptimeMs: packet.pingSentUptimeMs), on: box)

        case .pong:
            guard box.isAuthenticated, let sent = packet.pingSentUptimeMs else { return }
            let nowUptimeMs = Self.nowUptimeMs()
            box.awaitingPongSinceUptimeMs = nil
            box.unansweredPingCount = 0
            let rtt = max(0.5, nowUptimeMs - sent)
            oneWayLatencyMs = min(120.0, rtt * 0.5)

        case .rawBridgeFrame:
            guard box.isAuthenticated, let raw = packet.rawBridgeData else { return }
            onReceiveBridgeFrame?(raw, packet.livePositionMs)

        case .fullSnapshot:
            guard box.isAuthenticated, let snap = packet.snapshot else { return }
            onReceiveFullSnapshot?(snap)

        case .remoteCommand:
            guard box.isAuthenticated, let cmd = packet.command else { return }
            onReceiveRemoteCommand?(cmd)

        case .portalPreview:
            guard box.isAuthenticated else { return }
            onReceivePortalPreview?(packet.portal)

        case .portalCancel:
            guard box.isAuthenticated else { return }
            onReceivePortalPreview?(nil)

        case .portalThrow:
            guard box.isAuthenticated, let portal = packet.portal else { return }
            onReceivePortalPreview?(nil)
            onReceivePortalThrow?(portal)

        case .ownershipUpdate:
            guard box.isAuthenticated, let mode = packet.ownership else { return }
            onReceiveOwnershipUpdate?(mode, packet.activeOwnerPeerId)

        case .autonomousSync:
            guard box.isAuthenticated, let session = packet.autonomousSession else { return }
            onReceiveAutonomousSync?(session)

        case .autonomousStatePatch:
            guard box.isAuthenticated, let patch = packet.autonomousStatePatch else { return }
            onReceiveAutonomousStatePatch?(patch)

        case .autonomousStop:
            guard box.isAuthenticated else { return }
            onReceiveAutonomousStop?()
        }
    }

    // MARK: - 业务转发 API

    private func sendTrackedPing(on box: PeerConnectionBox, nowMs: Double) {
        if box.awaitingPongSinceUptimeMs == nil {
            box.awaitingPongSinceUptimeMs = nowMs
        }
        box.unansweredPingCount += 1
        sendPacket(PeerWirePacket(kind: .ping, pingSentUptimeMs: nowMs), on: box)
    }

    private func sendPingIfConnected() {
        guard let peerId = connectedPeerId,
              let box = activeAuthenticatedBox(for: peerId) else {
            return
        }
        sendTrackedPing(on: box, nowMs: Self.nowUptimeMs())
    }

    func sendBridgeFrame(_ rawData: Data, livePositionMs: Double?) {
        sendToActivePeer(
            PeerWirePacket(
                kind: .rawBridgeFrame,
                rawBridgeData: rawData,
                livePositionMs: livePositionMs
            )
        )
    }

    func sendFullSnapshot(_ snapshot: PeerFullSnapshot) {
        sendToActivePeer(PeerWirePacket(kind: .fullSnapshot, snapshot: snapshot))
    }

    func sendRemoteCommand(_ command: OutgoingCommand) {
        sendToActivePeer(PeerWirePacket(kind: .remoteCommand, command: command))
    }

    func sendPortalPreview(_ portal: PeerPortalPayload?) {
        if let portal {
            sendToActivePeer(PeerWirePacket(kind: .portalPreview, portal: portal))
        } else {
            sendToActivePeer(PeerWirePacket(kind: .portalCancel))
        }
    }

    func sendPortalThrow(_ portal: PeerPortalPayload) {
        sendToActivePeer(PeerWirePacket(kind: .portalThrow, portal: portal))
    }

    func sendOwnershipUpdate(mode: PeerDisplayOwnership, activeOwnerPeerId: String?) {
        sendToActivePeer(
            PeerWirePacket(
                kind: .ownershipUpdate,
                ownership: mode,
                activeOwnerPeerId: activeOwnerPeerId
            )
        )
    }

    func sendAutonomousSync(_ session: AutonomousSessionPayload) {
        sendToActivePeer(
            PeerWirePacket(
                kind: .autonomousSync,
                autonomousSession: session.withoutPreloads()
            )
        )
    }

    func sendAutonomousStatePatch(_ patch: AutonomousStatePatchPayload) {
        sendToActivePeer(
            PeerWirePacket(
                kind: .autonomousStatePatch,
                autonomousStatePatch: patch
            )
        )
    }

    func sendAutonomousStop() {
        sendToActivePeer(PeerWirePacket(kind: .autonomousStop))
    }
}
