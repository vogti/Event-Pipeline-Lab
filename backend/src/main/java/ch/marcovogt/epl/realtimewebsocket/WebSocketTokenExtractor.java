package ch.marcovogt.epl.realtimewebsocket;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

@Component
public class WebSocketTokenExtractor {

    public String extract(WebSocketSession session) {
        String headerToken = firstHeader(session, "X-EPL-Session");
        if (headerToken != null && !headerToken.isBlank()) {
            return headerToken.trim();
        }

        String authHeader = firstHeader(session, "Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7).trim();
            if (!token.isBlank()) {
                return token;
            }
        }

        URI uri = session.getUri();
        if (uri == null || uri.getQuery() == null) {
            return null;
        }

        String[] pairs = uri.getQuery().split("&");
        for (String pair : pairs) {
            String[] parts = pair.split("=", 2);
            if (parts.length == 2 && "token".equals(parts[0])) {
                return URLDecoder.decode(parts[1], StandardCharsets.UTF_8);
            }
        }

        return null;
    }

    private String firstHeader(WebSocketSession session, String name) {
        HttpHeaders headers = session.getHandshakeHeaders();
        List<String> values = headers.get(name);
        if (values == null || values.isEmpty()) {
            return null;
        }
        return values.get(0);
    }
}
