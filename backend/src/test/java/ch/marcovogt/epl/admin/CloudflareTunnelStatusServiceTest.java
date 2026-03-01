package ch.marcovogt.epl.admin;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CloudflareTunnelStatusServiceTest {

    @Test
    void disabledModeShouldSkipProbingAndReportDisabled() {
        CloudflareTunnelStatusService service = new CloudflareTunnelStatusService(
                false,
                "epl.marcovogt.ch",
                URI.create("http://127.0.0.1:1/ready"),
                URI.create("http://127.0.0.1:1/metrics"),
                Duration.ofMillis(200),
                fixedClock()
        );

        CloudflareTunnelStatus status = service.snapshot();

        assertThat(status.enabled()).isFalse();
        assertThat(status.hostname()).isEqualTo("epl.marcovogt.ch");
        assertThat(status.reachable()).isFalse();
        assertThat(status.ready()).isFalse();
        assertThat(status.haConnections()).isNull();
        assertThat(status.lastError()).isNull();
        assertThat(status.checkedAt()).isEqualTo(Instant.parse("2026-03-01T10:00:00Z"));
    }

    @Test
    void enabledModeShouldReportUnreachableProbeErrors() {
        CloudflareTunnelStatusService service = new CloudflareTunnelStatusService(
                true,
                "epl.marcovogt.ch",
                URI.create("http://127.0.0.1:1/ready"),
                URI.create("http://127.0.0.1:1/metrics"),
                Duration.ofMillis(200),
                fixedClock()
        );

        CloudflareTunnelStatus status = service.snapshot();

        assertThat(status.enabled()).isTrue();
        assertThat(status.reachable()).isFalse();
        assertThat(status.ready()).isFalse();
        assertThat(status.haConnections()).isNull();
        assertThat(status.lastError()).isNotBlank();
    }

    @Test
    void shouldParseHaConnectionsMetricFromPrometheusPayload() {
        String payload = """
                # HELP cloudflared_tunnel_ha_connections Number of active connections.
                # TYPE cloudflared_tunnel_ha_connections gauge
                cloudflared_tunnel_ha_connections{connection_id="0"} 1
                cloudflared_tunnel_ha_connections{connection_id="1"} 1
                """;

        Integer parsed = CloudflareTunnelStatusService.parseHaConnections(payload);

        assertThat(parsed).isEqualTo(2);
    }

    @Test
    void shouldReturnNullWhenHaConnectionsMetricMissing() {
        String payload = """
                # HELP something_else test
                something_else 42
                """;

        Integer parsed = CloudflareTunnelStatusService.parseHaConnections(payload);

        assertThat(parsed).isNull();
    }

    private static Clock fixedClock() {
        return Clock.fixed(Instant.parse("2026-03-01T10:00:00Z"), ZoneOffset.UTC);
    }
}
