package ch.marcovogt.epl.authsession;

import java.time.Instant;

public record AuthMeResponse(
        String sessionToken,
        String username,
        AppRole role,
        String groupKey,
        String displayName,
        Instant expiresAt
) {
    public static AuthMeResponse from(SessionPrincipal principal) {
        return new AuthMeResponse(
                principal.sessionToken(),
                principal.username(),
                principal.role(),
                principal.groupKey(),
                principal.displayName(),
                principal.expiresAt()
        );
    }
}
