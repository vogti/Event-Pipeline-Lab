package ch.marcovogt.epl.realtimewebsocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Component
public class StudentWebSocketBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(StudentWebSocketBroadcaster.class);

    private final ObjectMapper objectMapper;

    private final Set<WebSocketSession> allSessions = ConcurrentHashMap.newKeySet();
    private final Map<String, Set<WebSocketSession>> groupSessions = new ConcurrentHashMap<>();
    private final Map<String, String> sessionGroupKeys = new ConcurrentHashMap<>();

    public StudentWebSocketBroadcaster(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void register(WebSocketSession session, SessionPrincipal principal) {
        allSessions.add(session);
        sessionGroupKeys.put(session.getId(), principal.groupKey());
        groupSessions.computeIfAbsent(principal.groupKey(), ignored -> ConcurrentHashMap.newKeySet())
                .add(session);

        send(session, new WsEnvelope("ws.connected", "student channel connected", Instant.now()));
        log.info(
                "Student WS connected: sessionId={} groupKey={} activeSessions={}",
                session.getId(),
                principal.groupKey(),
                allSessions.size()
        );
    }

    public void unregister(WebSocketSession session) {
        allSessions.remove(session);

        String groupKey = sessionGroupKeys.remove(session.getId());
        if (groupKey != null) {
            Set<WebSocketSession> sessions = groupSessions.get(groupKey);
            if (sessions != null) {
                sessions.remove(session);
                if (sessions.isEmpty()) {
                    groupSessions.remove(groupKey);
                }
            }
        }

        log.info("Student WS disconnected: sessionId={} activeSessions={}", session.getId(), allSessions.size());
    }

    public void broadcastToGroup(String groupKey, String type, Object payload) {
        Set<WebSocketSession> sessions = groupSessions.get(groupKey);
        if (sessions == null || sessions.isEmpty()) {
            return;
        }

        WsEnvelope envelope = new WsEnvelope(type, payload, Instant.now());
        sessions.forEach(session -> send(session, envelope));
    }

    public void broadcastToAll(String type, Object payload) {
        WsEnvelope envelope = new WsEnvelope(type, payload, Instant.now());
        allSessions.forEach(session -> send(session, envelope));
    }

    public List<String> activeGroupKeys() {
        return new ArrayList<>(groupSessions.keySet());
    }

    public int activeSessionCount() {
        return allSessions.size();
    }

    private void send(WebSocketSession session, WsEnvelope envelope) {
        if (!session.isOpen()) {
            unregister(session);
            return;
        }

        try {
            String json = objectMapper.writeValueAsString(envelope);
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (IOException ex) {
            log.warn("Failed to send student WS message to session {}: {}", session.getId(), ex.getMessage());
            unregister(session);
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
