package ch.marcovogt.epl.admin;

import java.time.Instant;
import java.util.List;

public record AdminSystemStatusResponse(
        Instant generatedAt,
        List<SystemStatusEventRatePoint> eventsLast10Minutes,
        Double cpuLoadPct,
        Long ramUsedBytes,
        Long ramTotalBytes,
        long postgresSizeBytes,
        long storedEventCount,
        WebSocketSessionStats websocketSessions
) {
}
