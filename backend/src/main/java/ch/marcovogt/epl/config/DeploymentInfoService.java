package ch.marcovogt.epl.config;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.PropertySource;
import org.springframework.stereotype.Service;

@Service
@PropertySource(value = "classpath:epl-deployment.properties", ignoreResourceNotFound = true)
public class DeploymentInfoService {

    private static final int MAX_HASH_LEN = 16;
    private final DeploymentInfo deploymentInfo;

    public DeploymentInfoService(
            @Value("${epl.deployment.git-short-hash:}") String configuredHash,
            @Value("${epl.deployment.commit-url:}") String configuredCommitUrl,
            @Value("${epl.deployment.build-time:}") String configuredBuildTime,
            @Value("${epl.deployment.dirty:}") String configuredDirty
    ) {
        String resolvedHash = normalizeHash(resolve(configuredHash, System.getenv("EPL_GIT_SHORT_HASH"), "unknown"));
        String resolvedCommitUrl = normalizeCommitUrl(resolve(configuredCommitUrl, System.getenv("EPL_GIT_COMMIT_URL"), ""));
        Instant resolvedBuildTime = parseBuildTime(resolve(configuredBuildTime, System.getenv("EPL_BUILD_TIME"), ""));
        boolean resolvedDirty = parseDirty(resolve(configuredDirty, System.getenv("EPL_GIT_DIRTY"), "false"));
        this.deploymentInfo = new DeploymentInfo(
                resolvedHash,
                resolvedCommitUrl,
                resolvedBuildTime,
                resolvedDirty
        );
    }

    public String gitShortHash() {
        return deploymentInfo.gitShortHash();
    }

    public DeploymentInfo info() {
        return deploymentInfo;
    }

    private String resolve(String primary, String secondary, String fallback) {
        if (primary != null && !primary.isBlank()) {
            return primary;
        }
        if (secondary != null && !secondary.isBlank()) {
            return secondary;
        }
        return fallback;
    }

    private String normalizeHash(String raw) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.isBlank()) {
            return "unknown";
        }
        String sanitized = trimmed.replaceAll("[^0-9a-zA-Z._-]", "");
        if (sanitized.isBlank()) {
            return "unknown";
        }
        if (sanitized.length() > MAX_HASH_LEN) {
            return sanitized.substring(0, MAX_HASH_LEN);
        }
        return sanitized;
    }

    private String normalizeCommitUrl(String raw) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.isBlank()) {
            return "";
        }
        if (!(trimmed.startsWith("https://") || trimmed.startsWith("http://"))) {
            return "";
        }
        return trimmed;
    }

    private Instant parseBuildTime(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    private boolean parseDirty(String raw) {
        String value = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        return "true".equals(value) || "1".equals(value) || "yes".equals(value);
    }

    public record DeploymentInfo(
            String gitShortHash,
            String commitUrl,
            Instant buildTime,
            boolean dirty
    ) {
    }
}
