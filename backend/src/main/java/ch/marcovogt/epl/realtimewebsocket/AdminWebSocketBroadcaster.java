package ch.marcovogt.epl.realtimewebsocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import java.io.IOException;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Component
public class AdminWebSocketBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(AdminWebSocketBroadcaster.class);

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
    private final ObjectMapper objectMapper;

    public AdminWebSocketBroadcaster(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void register(WebSocketSession session) {
        sessions.add(session);
        send(session, new WsEnvelope("ws.connected", "admin channel connected", Instant.now()));
        log.info("Admin WS connected: sessionId={} activeSessions={}", session.getId(), sessions.size());
    }

    public void unregister(WebSocketSession session) {
        sessions.remove(session);
        log.info("Admin WS disconnected: sessionId={} activeSessions={}", session.getId(), sessions.size());
    }

    public void broadcastEvent(CanonicalEventDto eventDto) {
        broadcast(new WsEnvelope("event.feed.append", eventDto, Instant.now()));
    }

    public void broadcastDeviceStatus(DeviceStatusDto statusDto) {
        broadcast(new WsEnvelope("device.status.updated", statusDto, Instant.now()));
    }

    public void broadcastError(String message) {
        broadcast(new WsEnvelope("error.notification", message, Instant.now()));
    }

    private void broadcast(WsEnvelope envelope) {
        sessions.forEach(session -> send(session, envelope));
    }

    private void send(WebSocketSession session, WsEnvelope envelope) {
        if (!session.isOpen()) {
            sessions.remove(session);
            return;
        }

        try {
            String json = objectMapper.writeValueAsString(envelope);
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (IOException ex) {
            log.warn("Failed to send WS message to session {}: {}", session.getId(), ex.getMessage());
            sessions.remove(session);
            closeQuietly(session);
        }
    }

    private void closeQuietly(WebSocketSession session) {
        try {
            session.close();
        } catch (IOException ignored) {
            // ignore close failures
        }
    }
}
