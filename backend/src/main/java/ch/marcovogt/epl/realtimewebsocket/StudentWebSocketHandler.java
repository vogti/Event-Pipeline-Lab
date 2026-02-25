package ch.marcovogt.epl.realtimewebsocket;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class StudentWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(StudentWebSocketHandler.class);

    private final StudentWebSocketBroadcaster broadcaster;
    private final AuthService authService;
    private final WebSocketTokenExtractor tokenExtractor;

    public StudentWebSocketHandler(
            StudentWebSocketBroadcaster broadcaster,
            AuthService authService,
            WebSocketTokenExtractor tokenExtractor
    ) {
        this.broadcaster = broadcaster;
        this.authService = authService;
        this.tokenExtractor = tokenExtractor;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws IOException {
        String token = tokenExtractor.extract(session);
        SessionPrincipal principal = authService.resolveAndTouch(token).orElse(null);
        if (principal == null || principal.role() != AppRole.STUDENT) {
            session.close(CloseStatus.POLICY_VIOLATION.withReason("invalid session"));
            return;
        }

        session.getAttributes().put("groupKey", principal.groupKey());
        broadcaster.register(session, principal);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        log.debug("Ignoring incoming student WS message on session {}", session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        broadcaster.unregister(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.warn("Student WS transport error on session {}: {}", session.getId(), exception.getMessage());
        broadcaster.unregister(session);
    }
}
