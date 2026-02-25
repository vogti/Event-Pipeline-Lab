package ch.marcovogt.epl.authsession;

import java.time.Instant;

public record PresenceUserDto(
        String username,
        String displayName,
        Instant lastSeen
) {
}
