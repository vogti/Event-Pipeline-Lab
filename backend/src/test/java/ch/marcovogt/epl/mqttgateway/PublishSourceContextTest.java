package ch.marcovogt.epl.mqttgateway;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PublishSourceContextTest {

    @Test
    void shouldExposeSourceWithinScopeAndRestoreAfterwards() {
        PublishSourceContext context = new PublishSourceContext();

        assertThat(context.currentSource()).isNull();
        context.runWithSource("admin-user", () -> {
            assertThat(context.currentSource()).isEqualTo("admin-user");
        });
        assertThat(context.currentSource()).isNull();
    }

    @Test
    void shouldRestorePreviousSourceAfterNestedScope() {
        PublishSourceContext context = new PublishSourceContext();

        context.runWithSource("outer", () -> {
            assertThat(context.currentSource()).isEqualTo("outer");
            context.runWithSource("inner", () -> assertThat(context.currentSource()).isEqualTo("inner"));
            assertThat(context.currentSource()).isEqualTo("outer");
        });
        assertThat(context.currentSource()).isNull();
    }
}

