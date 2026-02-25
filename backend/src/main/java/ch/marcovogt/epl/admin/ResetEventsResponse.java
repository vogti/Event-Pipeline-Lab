package ch.marcovogt.epl.admin;

import java.time.Instant;

public record ResetEventsResponse(
        long deletedEvents,
        Instant resetAt
) {
}
