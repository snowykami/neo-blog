import Foundation
import Network
import os

/// 本地 127.0.0.1 WebSocket 服务（完全基于 Apple 原生 Network.framework NWProtocolWebSocket）
/// - 由系统底层 C 协议栈负责 HTTP 101 握手、RFC 6455 掩码解包、多分片大消息重组（上限 16MB）与 Ping/Pong 保活，零手写字节解帧；
/// - 仅监听回环网卡 127.0.0.1，拒绝无 Origin 或自身端口残留调试页连接。
@MainActor
final class LocalBridgeServer {
    struct ClientMeta: Equatable {
        let id: UUID
        var tabId: String
        var origin: String
    }

    private struct ClientEntry {
        var meta: ClientMeta
        let connection: NWConnection
    }

    private let logger = Logger(subsystem: "org.liteyuki.NeoBlogIsland", category: "BridgeServer")
    private var listener: NWListener?
    private var clients: [UUID: ClientEntry] = [:]
    private(set) var boundPort: UInt16 = 0

    var onRawJSONMessage: ((UUID, ClientMeta, Data) -> Void)?
    var onClientDisconnected: ((UUID, ClientMeta) -> Void)?
    var onClientsChanged: (([ClientMeta]) -> Void)?

    func start(preferredPorts: [UInt16] = [29170, 29171, 29172, 29173, 29174]) {
        tryPort(ports: preferredPorts, index: 0)
    }

    func stop() {
        for (_, entry) in clients {
            entry.connection.cancel()
        }
        clients.removeAll()
        listener?.cancel()
        listener = nil
    }

    func updateClientInfo(id: UUID, tabId: String?, origin: String?) {
        guard var entry = clients[id] else { return }
        var changed = false
        if let tabId, !tabId.isEmpty, entry.meta.tabId != tabId {
            entry.meta.tabId = tabId
            changed = true
        }
        if let origin, !origin.isEmpty, entry.meta.origin != origin {
            entry.meta.origin = origin
            changed = true
        }
        if changed {
            clients[id] = entry
            onClientsChanged?(clients.values.map(\.meta))
        }
    }

    func sendCommand(_ command: OutgoingCommand, to targetClientId: UUID?) {
        let envelope = OutgoingEnvelope(type: "command", command: command)
        guard let data = try? JSONEncoder().encode(envelope) else { return }

        let wsMeta = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "ws-command", metadata: [wsMeta])

        if let targetClientId, let target = clients[targetClientId] {
            target.connection.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
        } else if let first = clients.values.first {
            first.connection.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
        }
    }

    private func tryPort(ports: [UInt16], index: Int) {
        guard index < ports.count else {
            logger.error("所有候选本地端口均无法绑定")
            return
        }
        let portNum = ports[index]
        guard let nwPort = NWEndpoint.Port(rawValue: portNum) else { return }

        let tcpOptions = NWProtocolTCP.Options()
        tcpOptions.noDelay = true
        tcpOptions.enableKeepalive = true

        let wsOptions = NWProtocolWebSocket.Options()
        wsOptions.autoReplyPing = true
        // 单条完整消息上限设为 16MB，彻底容纳超长逐字 TTML + AI 标注 + 节拍脉冲列与大歌单
        wsOptions.maximumMessageSize = 16 * 1024 * 1024
        wsOptions.setClientRequestHandler(.main) { subprotocols, additionalHeaders in
            let origin = additionalHeaders
                .first(where: { $0.name.caseInsensitiveCompare("Origin") == .orderedSame })?
                .value
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            let validScheme = origin.hasPrefix("http://") || origin.hasPrefix("https://")
            let isSelfPort = origin == "http://127.0.0.1:\(portNum)" || origin == "http://localhost:\(portNum)"
            guard validScheme && !isSelfPort else {
                return NWProtocolWebSocket.Response(status: .reject, subprotocol: nil)
            }
            return NWProtocolWebSocket.Response(status: .accept, subprotocol: subprotocols.first)
        }

        let params = NWParameters(tls: nil, tcp: tcpOptions)
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: nwPort)
        params.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

        guard let nwListener = try? NWListener(using: params) else {
            tryPort(ports: ports, index: index + 1)
            return
        }

        nwListener.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    self.boundPort = portNum
                    self.logger.info("NWProtocolWebSocket 已就绪，监听 127.0.0.1:\(portNum)")
                case .failed(let err):
                    self.logger.warning("端口 \(portNum) 绑定失败: \(err.localizedDescription, privacy: .public)，尝试下一端口")
                    nwListener.cancel()
                    self.tryPort(ports: ports, index: index + 1)
                default:
                    break
                }
            }
        }

        nwListener.newConnectionHandler = { [weak self] conn in
            Task { @MainActor in
                self?.acceptWebSocketConnection(conn)
            }
        }

        self.listener = nwListener
        nwListener.start(queue: .main)
    }

    private func acceptWebSocketConnection(_ conn: NWConnection) {
        let clientId = UUID()
        let meta = ClientMeta(id: clientId, tabId: clientId.uuidString, origin: "connecting")
        clients[clientId] = ClientEntry(meta: meta, connection: conn)
        onClientsChanged?(clients.values.map(\.meta))

        conn.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .failed, .cancelled:
                    self.removeClient(clientId)
                default:
                    break
                }
            }
        }

        conn.start(queue: .main)
        receiveNextMessage(clientId: clientId, conn: conn)
    }

    private func receiveNextMessage(clientId: UUID, conn: NWConnection) {
        // 注意：在 NWProtocolWebSocket 面向消息的协议栈中，isComplete == true 表示「当前单条 WebSocket 消息接收完毕」，
        // 绝非 TCP 连接断开！连接关闭仅由 error != nil、wsMeta.opcode == .close 或 context.isFinal (无载荷 EOF) 触发。
        conn.receiveMessage { [weak self] content, context, _, error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.logger.debug("连接 \(clientId.uuidString, privacy: .public) 读取结束: \(error.localizedDescription, privacy: .public)")
                    self.removeClient(clientId)
                    return
                }

                if let wsMeta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata {
                    switch wsMeta.opcode {
                    case .close:
                        self.removeClient(clientId)
                        return
                    case .text, .binary:
                        if let content, !content.isEmpty, let entry = self.clients[clientId] {
                            self.onRawJSONMessage?(clientId, entry.meta, content)
                        }
                    default:
                        break
                    }
                } else if let content, !content.isEmpty, let entry = self.clients[clientId] {
                    self.onRawJSONMessage?(clientId, entry.meta, content)
                }

                let isStreamEOF = (context?.isFinal == true) && (content == nil || content?.isEmpty == true)
                if isStreamEOF {
                    self.removeClient(clientId)
                } else if self.clients[clientId] != nil {
                    self.receiveNextMessage(clientId: clientId, conn: conn)
                }
            }
        }
    }

    private func removeClient(_ id: UUID) {
        if let entry = clients.removeValue(forKey: id) {
            entry.connection.cancel()
            onClientDisconnected?(id, entry.meta)
            onClientsChanged?(clients.values.map(\.meta))
        }
    }
}
