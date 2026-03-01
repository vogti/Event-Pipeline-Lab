package ch.marcovogt.epl.admin;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class CloudflareTunnelStatusService {

    private static final Pattern HA_CONNECTIONS_METRIC_PATTERN =
            Pattern.compile("^cloudflared_tunnel_ha_connections(?:\\{[^}]*})?\\s+([0-9]+(?:\\.[0-9]+)?)$",
                    Pattern.MULTILINE);

    private final boolean enabled;
    private final String hostname;
    private final URI readyUri;
    private final URI metricsUri;
    private final Duration requestTimeout;
    private final HttpClient httpClient;
    private final Clock clock;

    @Autowired
    public CloudflareTunnelStatusService(
            @Value("${epl.cloudflare.enabled:false}") boolean enabled,
            @Value("${epl.cloudflare.hostname:}") String hostname,
            @Value("${epl.cloudflare.ready-url:http://cloudflared:2000/ready}") String readyUrl,
            @Value("${epl.cloudflare.metrics-url:http://cloudflared:2000/metrics}") String metricsUrl,
            @Value("${epl.cloudflare.request-timeout:PT2S}") Duration requestTimeout
    ) {
        this(enabled, hostname, URI.create(readyUrl), URI.create(metricsUrl), requestTimeout, Clock.systemUTC());
    }

    CloudflareTunnelStatusService(
            boolean enabled,
            String hostname,
            URI readyUri,
            URI metricsUri,
            Duration requestTimeout,
            Clock clock
    ) {
        this.enabled = enabled;
        this.hostname = hostname == null ? "" : hostname.trim();
        this.readyUri = readyUri;
        this.metricsUri = metricsUri;
        this.requestTimeout = normalizeTimeout(requestTimeout);
        this.clock = clock == null ? Clock.systemUTC() : clock;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(this.requestTimeout)
                .build();
    }

    public CloudflareTunnelStatus snapshot() {
        Instant checkedAt = Instant.now(clock);
        if (!enabled) {
            return new CloudflareTunnelStatus(false, hostname, false, false, null, checkedAt, null);
        }

        boolean reachable = false;
        boolean ready = false;
        Integer haConnections = null;
        StringBuilder errorBuilder = new StringBuilder();

        try {
            HttpResponse<String> readyResponse = requestText(readyUri);
            reachable = true;
            int status = readyResponse.statusCode();
            if (status >= 200 && status < 300) {
                String body = readyResponse.body() == null ? "" : readyResponse.body().trim().toLowerCase();
                ready = body.isEmpty() || body.contains("ok");
            } else {
                appendError(errorBuilder, "ready-http-" + status);
            }
        } catch (Exception ex) {
            appendError(errorBuilder, "ready-failed: " + sanitizeError(ex));
        }

        try {
            HttpResponse<String> metricsResponse = requestText(metricsUri);
            reachable = true;
            int status = metricsResponse.statusCode();
            if (status >= 200 && status < 300) {
                haConnections = parseHaConnections(metricsResponse.body());
                if (haConnections != null && haConnections > 0) {
                    ready = true;
                }
            } else {
                appendError(errorBuilder, "metrics-http-" + status);
            }
        } catch (Exception ex) {
            appendError(errorBuilder, "metrics-failed: " + sanitizeError(ex));
        }

        String error = errorBuilder.length() == 0 ? null : errorBuilder.toString();
        return new CloudflareTunnelStatus(enabled, hostname, reachable, ready, haConnections, checkedAt, error);
    }

    static Integer parseHaConnections(String metricsBody) {
        if (metricsBody == null || metricsBody.isBlank()) {
            return null;
        }
        Matcher matcher = HA_CONNECTIONS_METRIC_PATTERN.matcher(metricsBody);
        double sum = 0;
        boolean matched = false;
        while (matcher.find()) {
            String rawValue = matcher.group(1);
            try {
                double parsed = Double.parseDouble(rawValue);
                sum += parsed;
                matched = true;
            } catch (NumberFormatException ignored) {
                // Ignore malformed samples and continue parsing valid lines.
            }
        }
        if (!matched) {
            return null;
        }
        return (int) Math.round(sum);
    }

    private HttpResponse<String> requestText(URI uri) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .timeout(requestTimeout)
                .GET()
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private static Duration normalizeTimeout(Duration timeout) {
        if (timeout == null || timeout.isNegative() || timeout.isZero()) {
            return Duration.ofSeconds(2);
        }
        return timeout;
    }

    private static String sanitizeError(Exception ex) {
        String message = ex.getMessage();
        if (message == null || message.isBlank()) {
            return ex.getClass().getSimpleName();
        }
        return message;
    }

    private static void appendError(StringBuilder builder, String message) {
        if (message == null || message.isBlank()) {
            return;
        }
        if (builder.length() > 0) {
            builder.append(" | ");
        }
        builder.append(message);
    }
}
