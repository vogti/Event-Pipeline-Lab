package ch.marcovogt.epl.config;

import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketHandler;
import ch.marcovogt.epl.realtimewebsocket.StudentWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final AdminWebSocketHandler adminWebSocketHandler;
    private final StudentWebSocketHandler studentWebSocketHandler;

    public WebSocketConfig(
            AdminWebSocketHandler adminWebSocketHandler,
            StudentWebSocketHandler studentWebSocketHandler
    ) {
        this.adminWebSocketHandler = adminWebSocketHandler;
        this.studentWebSocketHandler = studentWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(adminWebSocketHandler, "/ws/admin")
                .setAllowedOriginPatterns("*");

        registry.addHandler(studentWebSocketHandler, "/ws/student")
                .setAllowedOriginPatterns("*");
    }
}
