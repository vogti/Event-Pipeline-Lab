package ch.marcovogt.epl.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DeploymentInfoServiceTest {

    @Test
    void shouldUseConfiguredHashAsIsWhenAlreadyValid() {
        DeploymentInfoService service = new DeploymentInfoService("a1b2c3d4", "", "", "false");

        assertThat(service.gitShortHash()).isEqualTo("a1b2c3d4");
        assertThat(service.info().commitUrl()).isEmpty();
        assertThat(service.info().buildTime()).isNull();
        assertThat(service.info().dirty()).isFalse();
    }

    @Test
    void shouldSanitizeAndTruncateConfiguredHash() {
        DeploymentInfoService service = new DeploymentInfoService("  abcd$%^1234567890xyz  ", "", "", "false");

        assertThat(service.gitShortHash()).isEqualTo("abcd1234567890xy");
    }

    @Test
    void shouldReturnUnknownWhenConfiguredHashHasNoAllowedChars() {
        DeploymentInfoService service = new DeploymentInfoService("$$$%%%", "", "", "false");

        assertThat(service.gitShortHash()).isEqualTo("unknown");
    }

    @Test
    void shouldExposeCommitUrlBuildTimeAndDirtyFlag() {
        DeploymentInfoService service = new DeploymentInfoService(
                "abc123",
                "https://github.com/example/repo/commit/abc123",
                "2026-03-01T12:00:00Z",
                "true"
        );

        assertThat(service.info().commitUrl()).isEqualTo("https://github.com/example/repo/commit/abc123");
        assertThat(service.info().buildTime()).hasToString("2026-03-01T12:00:00Z");
        assertThat(service.info().dirty()).isTrue();
    }
}
