package ch.marcovogt.epl.externalsources;

import java.time.Instant;

public record ExternalStreamRuntimeStatus(
        boolean online,
        Instant lastConnectedAt,
        Instant lastEventAt,
        Instant checkedAt,
        String lastError
) {
}
