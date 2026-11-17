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
    let livePositionMs: Double
    let isPlaying: Bool
}

struct PeerWirePacket: Codable, Sendable {
    enum Kind: String, Codable, Sendable {
        case hello
        case pairRequest = "pair_request"
        case pairResponse = "pair_response"
        case ping
        case pong
        case rawBridgeFrame = "raw_bridge_frame"
        case fullSnapshot = "full_snapshot"
        case remoteCommand = "remote_command"
        case portalPreview = "portal_preview"
        case portalCancel = "portal_cancel"
        case portalThrow = "portal_throw"
        case ownershipUpdate = "ownership_update"
    }

    let kind: Kind
    var peerId: String? = nil
    var deviceName: String? = nil
    var pairToken: String? = nil
    var accepted: Bool? = nil
    var pingSentUptimeMs: Double? = nil
    var rawBridgeData: Data? = nil
    var livePositionMs: Double? = nil
    var snapshot: PeerFullSnapshot? = nil
    var command: OutgoingCommand? = nil
    var portal: PeerPortalPayload? = nil
    var ownership: PeerDisplayOwnership? = nil
    var activeOwnerPeerId: String? = nil
}

/// 基于 Apple Network.framework (`includePeerToPeer = true` / AWDL `awdl0` + Bonjour `_neoblog._tcp`) 的跨 Mac 点对点直连服务：
/// - 无需两台 Mac 处于同一路由器局域网（直接复用通用控制与 AirDrop 同款蓝牙唤醒 + 5GHz AWDL 无线直连）；
/// - 采用 4 字节大端长度前缀帧封装 JSON，彻底规避 `awdl0` IPv6 链路本地地址下的 HTTP Host 握手兼容问题；
/// - 内置首次连接配对授权与本地信任列表持久化，靠近后静默自动重连。
@Observable
@MainActor
final class PeerContinuityService {
    static let bonjourServiceType = "_neoblog._tcp"
    private static let localPeerIdKey = "NeoBlogIsland.peer.localId"
    private static let trustedPeersKey = "NeoBlogIsland.peer.trustedTokens"
    private static let maxFrameBytes = 20 * 1024 * 1024

    private final class PeerConnectionBox {
        let id: UUID
        let connection: NWConnection
        let isOutbound: Bool
        var receiveBuffer = Data()
        var remotePeerId: String?
        var remoteDeviceName: String?
        var remoteServiceName: String?
        var isAuthenticated: Bool = false

        init(id: UUID, connection: NWConnection, isOutbound: Bool, remoteServiceName: String? = nil) {
            self.id = id
            self.connection = connection
            self.isOutbound = isOutbound
            self.remoteServiceName = remoteServiceName
        }
    }

    @ObservationIgnored private let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "PeerContinuity")
    @ObservationIgnored private var listener: NWListener?
    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var connections: [UUID: PeerConnectionBox] = [:]
    @ObservationIgnored private var pingTimer: Timer?
    @ObservationIgnored private var autoReconnectTimer: Timer?
    @ObservationIgnored private var serviceNamesByPeerPrefix: [String: String] = [:]

    let localPeerId: String
    let localServiceName: String
    let localDeviceName: String

    /// key: remotePeerId (或前缀), value: 配对共享 token
    private(set) var trustedTokens: [String: String] = [:]
    /// key: remotePeerId, value: 最近一次已知设备名
    private(set) var knownPeerNames: [String: String] = [:]

    private(set) var discoveredPeers: [DiscoveredPeerMac] = []
    private(set) var connectedPeerId: String? = nil
    private(set) var connectedPeerName: String? = nil
    private(set) var oneWayLatencyMs: Double = 4.0
    private(set) var pendingPairRequest: PendingPairRequest? = nil
    private(set) var isAwaitingRemoteApproval: Bool = false
    private(set) var directListeningPort: UInt16 = 0

    var isConnected: Bool { connectedPeerId != nil }

    @ObservationIgnored var onPeerAuthenticated: ((String, String) -> Void)?
    @ObservationIgnored var onPeerDisconnected: ((String) -> Void)?
    @ObservationIgnored var onReceiveBridgeFrame: ((Data, Double?) -> Void)?
    @ObservationIgnored var onReceiveFullSnapshot: ((PeerFullSnapshot) -> Void)?
    @ObservationIgnored var onReceiveRemoteCommand: ((OutgoingCommand) -> Void)?
    @ObservationIgnored var onReceivePortalPreview: ((PeerPortalPayload?) -> Void)?
    @ObservationIgnored var onReceivePortalThrow: ((PeerPortalPayload) -> Void)?
    @ObservationIgnored var onReceiveOwnershipUpdate: ((PeerDisplayOwnership, String?) -> Void)?

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

        let cleanHex = self.localPeerId.replacingOccurrences(of: "-", with: "").prefix(10)
        self.localServiceName = "nb-\(cleanHex)"
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

    // MARK: - 生命周期：AWDL + Bonjour 广播与扫描

    func start() {
        guard listener == nil, browser == nil else { return }
        startBonjourListener()
        startBonjourBrowser()
        startTimers()
    }

    /// 供单元测试在本地回环端口直接启动（不触发系统本地网络隐私弹窗）
    func startLoopbackForTesting() {
        let tcp = Self.makeTCPOptions()
        let params = NWParameters(tls: nil, tcp: tcp)
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        guard let nwListener = try? NWListener(using: params) else { return }

        nwListener.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
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
    }

    func connectLoopbackForTesting(port: UInt16, requestPairingIfUntrusted: Bool = true) {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { return }
        let endpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: nwPort)
        openOutboundConnection(to: endpoint, serviceName: nil, manualPairRequest: requestPairingIfUntrusted)
    }

    func stop() {
        pingTimer?.invalidate()
        pingTimer = nil
        autoReconnectTimer?.invalidate()
        autoReconnectTimer = nil
        browser?.cancel()
        browser = nil
        listener?.cancel()
        listener = nil
        for (_, box) in connections {
            box.connection.cancel()
        }
        connections.removeAll()
        connectedPeerId = nil
        connectedPeerName = nil
        pendingPairRequest = nil
        isAwaitingRemoteApproval = false
    }

    private static func makeTCPOptions() -> NWProtocolTCP.Options {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        tcp.enableKeepalive = true
        tcp.keepaliveIdle = 10
        return tcp
    }

    private static func makeP2PParameters() -> NWParameters {
        let params = NWParameters(tls: nil, tcp: makeTCPOptions())
        params.includePeerToPeer = true
        return params
    }

    private func startBonjourListener() {
        let params = Self.makeP2PParameters()
        guard let nwListener = try? NWListener(using: params) else {
            logger.error("无法创建 AWDL/Bonjour NWListener")
            return
        }
        nwListener.service = NWListener.Service(name: localServiceName, type: Self.bonjourServiceType)
        nwListener.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    self.logger.info("AWDL/Bonjour 监听已就绪: \(self.localServiceName, privacy: .public)")
                case .failed(let err):
                    self.logger.warning("AWDL/Bonjour 监听异常: \(err.localizedDescription, privacy: .public)")
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

    private func startBonjourBrowser() {
        let params = NWParameters()
        params.includePeerToPeer = true
        let nwBrowser = NWBrowser(
            for: .bonjour(type: Self.bonjourServiceType, domain: nil),
            using: params
        )
        nwBrowser.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                self?.handleBrowseResults(results)
            }
        }
        self.browser = nwBrowser
        nwBrowser.start(queue: .main)
    }

    private func startTimers() {
        pingTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.sendPingIfConnected()
            }
        }
        autoReconnectTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.attemptAutoConnectToTrustedPeer()
            }
        }
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
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
        attemptAutoConnectToTrustedPeer()
    }

    private func attemptAutoConnectToTrustedPeer() {
        guard !isConnected else { return }
        guard connections.values.allSatisfy({ !$0.isOutbound }) else { return }
        for peer in discoveredPeers where peer.isTrusted {
            // 双方都已互信时，由 serviceName 字典序较小的一方主动发起自动重连，避免双向同时撞车
            if localServiceName < peer.serviceName {
                openOutboundConnection(to: peer.endpoint, serviceName: peer.serviceName, manualPairRequest: false)
                break
            }
        }
    }

    // MARK: - 手动发起配对连接 / 信任审批 / 解除配对

    func connectToDiscoveredPeer(_ peer: DiscoveredPeerMac) {
        if isConnected { disconnectCurrentPeer() }
        openOutboundConnection(to: peer.endpoint, serviceName: peer.serviceName, manualPairRequest: true)
    }

    func disconnectCurrentPeer() {
        let oldId = connectedPeerId
        for (_, box) in connections {
            box.connection.cancel()
        }
        connections.removeAll()
        connectedPeerId = nil
        connectedPeerName = nil
        isAwaitingRemoteApproval = false
        if let oldId {
            onPeerDisconnected?(oldId)
        }
    }

    func unpairAllPeers() {
        trustedTokens.removeAll()
        knownPeerNames.removeAll()
        backingDefaults.removeObject(forKey: Self.trustedPeersKey)
        backingDefaults.removeObject(forKey: Self.trustedPeersKey + ".names")
        disconnectCurrentPeer()
        // 刷新已发现列表中的信任状态
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
                    accepted: true
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
                self?.closeConnection(id)
            }
        }
    }

    private func saveTrust(peerId: String, deviceName: String, token: String) {
        trustedTokens[peerId] = token
        knownPeerNames[peerId] = deviceName
        backingDefaults.set(trustedTokens, forKey: Self.trustedPeersKey)
        backingDefaults.set(knownPeerNames, forKey: Self.trustedPeersKey + ".names")

        let prefixHex = String(peerId.replacingOccurrences(of: "-", with: "").prefix(10))
        discoveredPeers = discoveredPeers.map { item in
            guard item.serviceName == "nb-\(prefixHex)" else { return item }
            var copy = item
            copy.displayName = deviceName
            copy.isTrusted = true
            return copy
        }
    }

    // MARK: - 连接建立与 4 字节大端长度帧收发

    private func acceptInbound(_ conn: NWConnection) {
        let id = UUID()
        let box = PeerConnectionBox(id: id, connection: conn, isOutbound: false)
        connections[id] = box
        setupConnectionLifecycle(box, manualPairRequest: false)
    }

    private func openOutboundConnection(to endpoint: NWEndpoint, serviceName: String?, manualPairRequest: Bool) {
        let conn = NWConnection(to: endpoint, using: Self.makeP2PParameters())
        let id = UUID()
        let box = PeerConnectionBox(id: id, connection: conn, isOutbound: true, remoteServiceName: serviceName)
        connections[id] = box
        if manualPairRequest {
            isAwaitingRemoteApproval = true
        }
        setupConnectionLifecycle(box, manualPairRequest: manualPairRequest)
    }

    private func setupConnectionLifecycle(_ box: PeerConnectionBox, manualPairRequest: Bool) {
        let connId = box.id
        box.connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, let currentBox = self.connections[connId] else { return }
                switch state {
                case .ready:
                    if currentBox.isOutbound {
                        self.sendOutboundHello(on: currentBox, manualPairRequest: manualPairRequest)
                    }
                case .failed, .cancelled:
                    self.closeConnection(connId)
                default:
                    break
                }
            }
        }
        box.connection.start(queue: .main)
        readLoop(connId: connId)
    }

    private func sendOutboundHello(on box: PeerConnectionBox, manualPairRequest: Bool) {
        // 查找已保存的配对 token（按已知 peerId 或服务名前缀匹配）
        var matchedToken: String? = nil
        if let svc = box.remoteServiceName, svc.hasPrefix("nb-") {
            let prefixHex = String(svc.dropFirst(3))
            matchedToken = trustedTokens.first { key, _ in
                key.replacingOccurrences(of: "-", with: "").hasPrefix(prefixHex)
            }?.value
        } else if trustedTokens.count == 1 {
            matchedToken = trustedTokens.values.first
        }

        if let token = matchedToken {
            sendPacket(
                PeerWirePacket(
                    kind: .hello,
                    peerId: localPeerId,
                    deviceName: localDeviceName,
                    pairToken: token
                ),
                on: box
            )
        } else if manualPairRequest {
            sendPacket(
                PeerWirePacket(
                    kind: .pairRequest,
                    peerId: localPeerId,
                    deviceName: localDeviceName
                ),
                on: box
            )
        } else {
            closeConnection(box.id)
        }
    }

    private func readLoop(connId: UUID) {
        guard let box = connections[connId] else { return }
        box.connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            Task { @MainActor in
                guard let self, let activeBox = self.connections[connId] else { return }
                if let data, !data.isEmpty {
                    activeBox.receiveBuffer.append(data)
                    if !self.drainFrames(on: activeBox) {
                        self.closeConnection(connId)
                        return
                    }
                }
                if error != nil || isComplete {
                    self.closeConnection(connId)
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
            }
        }
        return true
    }

    private func sendPacket(_ packet: PeerWirePacket, on box: PeerConnectionBox) {
        guard let json = try? JSONEncoder().encode(packet), json.count <= Self.maxFrameBytes else { return }
        let len = UInt32(json.count).bigEndian
        var framed = Data(capacity: 4 + json.count)
        withUnsafeBytes(of: len) { framed.append(contentsOf: $0) }
        framed.append(json)
        box.connection.send(content: framed, completion: .idempotent)
    }

    private func sendToActivePeer(_ packet: PeerWirePacket) {
        guard let peerId = connectedPeerId,
              let box = connections.values.first(where: { $0.isAuthenticated && $0.remotePeerId == peerId }) else {
            return
        }
        sendPacket(packet, on: box)
    }

    private func closeConnection(_ connId: UUID) {
        guard let removed = connections.removeValue(forKey: connId) else { return }
        removed.connection.cancel()
        if pendingPairRequest?.connId == connId {
            pendingPairRequest = nil
        }
        if removed.isOutbound {
            isAwaitingRemoteApproval = false
        }
        if let rId = removed.remotePeerId, connectedPeerId == rId {
            let stillHasOther = connections.values.contains { $0.isAuthenticated && $0.remotePeerId == rId }
            if !stillHasOther {
                connectedPeerId = nil
                connectedPeerName = nil
                onPeerDisconnected?(rId)
            }
        }
    }

    private func promoteAuthenticatedConnection(_ box: PeerConnectionBox, peerId: String, deviceName: String) {
        box.remotePeerId = peerId
        box.remoteDeviceName = deviceName
        box.isAuthenticated = true
        isAwaitingRemoteApproval = false

        // 关闭与同一台对端多余的并发连接
        let duplicateIds = connections.values
            .filter { $0.id != box.id && $0.remotePeerId == peerId }
            .map(\.id)
        for dupId in duplicateIds {
            if let dup = connections.removeValue(forKey: dupId) {
                dup.connection.cancel()
            }
        }

        let changed = (connectedPeerId != peerId)
        connectedPeerId = peerId
        connectedPeerName = deviceName
        if changed {
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
                closeConnection(box.id)
                return
            }
            let devName = packet.deviceName ?? "Mac"
            if let expectedToken = trustedTokens[peerId],
               let provided = packet.pairToken,
               provided == expectedToken {
                saveTrust(peerId: peerId, deviceName: devName, token: expectedToken)
                let wasAlreadyAuth = box.isAuthenticated
                if !wasAlreadyAuth && !box.isOutbound {
                    // 入站连接验证通过，先回发 hello 让对端完成认证，再触发快照推送
                    sendPacket(
                        PeerWirePacket(
                            kind: .hello,
                            peerId: localPeerId,
                            deviceName: localDeviceName,
                            pairToken: expectedToken
                        ),
                        on: box
                    )
                }
                promoteAuthenticatedConnection(box, peerId: peerId, deviceName: devName)
            } else if box.isOutbound {
                // 本地旧 token 失效，自动降级发起配对请求
                sendPacket(
                    PeerWirePacket(
                        kind: .pairRequest,
                        peerId: localPeerId,
                        deviceName: localDeviceName
                    ),
                    on: box
                )
                isAwaitingRemoteApproval = true
            } else {
                // 对端持旧 token 连入，转为待用户确认配对
                box.remotePeerId = peerId
                box.remoteDeviceName = devName
                pendingPairRequest = PendingPairRequest(connId: box.id, peerId: peerId, deviceName: devName)
            }

        case .pairRequest:
            guard let peerId = packet.peerId, peerId != localPeerId else {
                closeConnection(box.id)
                return
            }
            let devName = packet.deviceName ?? "附近的 Mac"
            box.remotePeerId = peerId
            box.remoteDeviceName = devName
            pendingPairRequest = PendingPairRequest(connId: box.id, peerId: peerId, deviceName: devName)

        case .pairResponse:
            isAwaitingRemoteApproval = false
            guard packet.accepted == true,
                  let peerId = packet.peerId,
                  let token = packet.pairToken else {
                closeConnection(box.id)
                return
            }
            let devName = packet.deviceName ?? "Mac"
            saveTrust(peerId: peerId, deviceName: devName, token: token)
            promoteAuthenticatedConnection(box, peerId: peerId, deviceName: devName)

        case .ping:
            guard box.isAuthenticated else { return }
            sendPacket(PeerWirePacket(kind: .pong, pingSentUptimeMs: packet.pingSentUptimeMs), on: box)

        case .pong:
            guard box.isAuthenticated, let sent = packet.pingSentUptimeMs else { return }
            let nowUptimeMs = ProcessInfo.processInfo.systemUptime * 1000.0
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
        }
    }

    // MARK: - 业务转发 API

    private func sendPingIfConnected() {
        let nowUptimeMs = ProcessInfo.processInfo.systemUptime * 1000.0
        sendToActivePeer(PeerWirePacket(kind: .ping, pingSentUptimeMs: nowUptimeMs))
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
}
