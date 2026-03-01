package ch.marcovogt.epl.admin;

import java.time.Instant;

public record CloudflareTunnelStatus(
        boolean enabled,
        String hostname,
        boolean reachable,
        boolean ready,
        Integer haConnections,
        Instant checkedAt,
        String lastError
) {
}
