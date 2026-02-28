package ch.marcovogt.epl.mqttgateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class PublishedEventSourceTrackerTest {

    @Test
    void shouldConsumeRegisteredSourceForMatchingTopicAndPayload() {
        PublishedEventSourceTracker tracker = new PublishedEventSourceTracker(Duration.ofSeconds(30));

        tracker.register("epld01/event/button/black", "{\"pressed\":true}", "alice");

        assertThat(tracker.consume("epld01/event/button/black", "{\"pressed\":true}")).isEqualTo("alice");
        assertThat(tracker.consume("epld01/event/button/black", "{\"pressed\":true}")).isNull();
    }

    @Test
    void shouldMatchEntriesInRegistrationOrderForSameTopicAndPayload() {
        PublishedEventSourceTracker tracker = new PublishedEventSourceTracker(Duration.ofSeconds(30));

        tracker.register("epld01/event/counter", "{\"counter\":1}", "alice");
        tracker.register("epld01/event/counter", "{\"counter\":1}", "bob");

        assertThat(tracker.consume("epld01/event/counter", "{\"counter\":1}")).isEqualTo("alice");
        assertThat(tracker.consume("epld01/event/counter", "{\"counter\":1}")).isEqualTo("bob");
        assertThat(tracker.consume("epld01/event/counter", "{\"counter\":1}")).isNull();
    }
}

