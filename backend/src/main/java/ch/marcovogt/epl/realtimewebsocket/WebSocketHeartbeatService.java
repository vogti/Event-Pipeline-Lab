package ch.marcovogt.epl.realtimewebsocket;

import java.time.Instant;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class WebSocketHeartbeatService {

    private final AdminWebSocketBroadcaster adminBroadcaster;
    private final StudentWebSocketBroadcaster studentBroadcaster;

    public WebSocketHeartbeatService(
            AdminWebSocketBroadcaster adminBroadcaster,
            StudentWebSocketBroadcaster studentBroadcaster
    ) {
        this.adminBroadcaster = adminBroadcaster;
        this.studentBroadcaster = studentBroadcaster;
    }

    @Scheduled(fixedDelayString = "${epl.websocket.heartbeat-interval-ms:25000}")
    public void broadcastHeartbeat() {
        Instant now = Instant.now();
        adminBroadcaster.broadcast("ws.ping", now);
        studentBroadcaster.broadcastToAll("ws.ping", now);
    }
}
