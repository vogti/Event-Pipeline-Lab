package com.sostiges.epl.eventingestionnormalization;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CanonicalEventNormalizerTest {

    private CanonicalEventNormalizer normalizer;

    @BeforeEach
    void setUp() {
        normalizer = new CanonicalEventNormalizer(new ObjectMapper());
    }

    @Test
    void shouldNormalizeCanonicalTopic() {
        String topic = "epld/epld01/event/button";
        byte[] payload = "{\"button\":\"black\",\"action\":\"press\"}".getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:00Z"));

        assertThat(normalized.event().getDeviceId()).isEqualTo("epld01");
        assertThat(normalized.event().getEventType()).isEqualTo("button.black.press");
        assertThat(normalized.event().isValid()).isTrue();
    }

    @Test
    void shouldNormalizeShellyNotifyStatusButton() {
        String topic = "epld01/events/rpc";
        byte[] payload = """
                {
                  "method":"NotifyStatus",
                  "params":{
                    "ts":1772015093.26,
                    "input:0":{"state":true}
                  }
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:01Z"));

        assertThat(normalized.event().getDeviceId()).isEqualTo("epld01");
        assertThat(normalized.event().getEventType()).isEqualTo("button.red.press");
        assertThat(normalized.event().getDeviceTs()).isNotNull();
    }

    @Test
    void shouldMarkInvalidWhenPayloadNotJson() {
        String topic = "epld/epld01/status/heartbeat";
        byte[] payload = "on".getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:02Z"));

        assertThat(normalized.event().isValid()).isFalse();
        assertThat(normalized.event().getValidationErrors()).contains("payload-not-json");
    }
}
