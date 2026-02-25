package ch.marcovogt.epl.authsession;

import java.time.Instant;

public record SessionPrincipal(
        String sessionToken,
        String username,
        AppRole role,
        String groupKey,
        String displayName,
        Instant expiresAt
) {
}
