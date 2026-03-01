package ch.marcovogt.epl.authsession;

import ch.marcovogt.epl.config.DeploymentInfoService.DeploymentInfo;
import java.time.Instant;

public record AuthMeResponse(
        String sessionToken,
        String username,
        AppRole role,
        String groupKey,
        String displayName,
        Instant expiresAt,
        String deploymentGitHash,
        String deploymentCommitUrl,
        Instant deploymentBuildTs,
        boolean deploymentDirty
) {
    public static AuthMeResponse from(SessionPrincipal principal, DeploymentInfo deploymentInfo) {
        return new AuthMeResponse(
                principal.sessionToken(),
                principal.username(),
                principal.role(),
                principal.groupKey(),
                principal.displayName(),
                principal.expiresAt(),
                deploymentInfo == null ? "unknown" : deploymentInfo.gitShortHash(),
                deploymentInfo == null ? "" : deploymentInfo.commitUrl(),
                deploymentInfo == null ? null : deploymentInfo.buildTime(),
                deploymentInfo != null && deploymentInfo.dirty()
        );
    }
}
