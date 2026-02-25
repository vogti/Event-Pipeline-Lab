package ch.marcovogt.epl.admin;

import java.time.Instant;

public record SystemStatusEventRatePoint(
        Instant minuteTs,
        long eventCount
) {
}
