package ch.marcovogt.epl.externalsources;

import java.time.Instant;

public record ExternalStreamSourceDto(
        String sourceId,
        String displayName,
        boolean enabled,
        String endpointUrl,
        boolean online,
        Instant lastConnectedAt,
        Instant lastEventAt,
        Instant statusCheckedAt,
        String lastError,
        long eventsSinceReset,
        Instant counterResetAt,
        Instant updatedAt,
        String updatedBy
) {
}
