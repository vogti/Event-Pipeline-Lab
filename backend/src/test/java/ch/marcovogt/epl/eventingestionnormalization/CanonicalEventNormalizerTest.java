package ch.marcovogt.epl.eventingestionnormalization;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.common.EventCategory;
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
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/button/black");
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
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/button/red");
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

    @Test
    void shouldRewriteRpcStatusTopicToCanonicalStatusTopic() {
        String topic = "epld01/events/rpc";
        byte[] payload = """
                {
                  "method":"NotifyStatus",
                  "params":{
                    "mqtt":{"connected":true}
                  }
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:03Z"));

        assertThat(normalized.event().getEventType()).isEqualTo("status.mqtt");
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/status/mqtt");
    }

    @Test
    void shouldRewriteRpcTemperatureTopicToCanonicalTemperatureTopic() {
        String topic = "epld01/events/rpc";
        byte[] payload = """
                {
                  "method":"NotifyStatus",
                  "params":{
                    "temperature:100":{"value":23.4}
                  }
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:03Z"));

        assertThat(normalized.event().getEventType()).isEqualTo("sensor.temperature");
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/sensor/temperature");
    }

    @Test
    void shouldRewriteRpcHumidityTopicToCanonicalHumidityTopic() {
        String topic = "epld01/events/rpc";
        byte[] payload = """
                {
                  "method":"NotifyStatus",
                  "params":{
                    "humidity:100":{"value":57.8}
                  }
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:03Z"));

        assertThat(normalized.event().getEventType()).isEqualTo("sensor.humidity");
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/sensor/humidity");
    }

    @Test
    void shouldNormalizeDht22TopicToTemperatureWhenPayloadContainsTemperature() {
        String topic = "epld01/event/sensor/dht22";
        byte[] payload = """
                {
                  "temperature":21.6
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:03Z"));

        assertThat(normalized.event().getEventType()).isEqualTo("sensor.temperature");
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/sensor/temperature");
    }

    @Test
    void shouldNormalizeDht22TopicToHumidityWhenPayloadContainsHumidity() {
        String topic = "epld01/event/sensor/dht22";
        byte[] payload = """
                {
                  "humidity":58.2
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:03Z"));

        assertThat(normalized.event().getEventType()).isEqualTo("sensor.humidity");
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/sensor/humidity");
    }

    @Test
    void shouldDefaultDht22TopicToTemperatureWhenPayloadContainsBothValues() {
        String topic = "epld01/event/sensor/dht22";
        byte[] payload = """
                {
                  "temperature":22.1,
                  "humidity":49.9
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:03Z"));

        assertThat(normalized.event().getEventType()).isEqualTo("sensor.temperature");
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/sensor/temperature");
    }

    @Test
    void shouldUsePayloadVirtualDeviceIdForMirroredRpcTopic() {
        String topic = "epld01/events/rpc";
        byte[] payload = """
                {
                  "deviceId":"eplvd01",
                  "groupKey":"epld01",
                  "method":"NotifyStatus",
                  "params":{
                    "input:0":{"state":true}
                  }
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-25T10:00:04Z"));

        assertThat(normalized.event().getDeviceId()).isEqualTo("eplvd01");
        assertThat(normalized.event().getGroupKey()).isEqualTo("epld01");
        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/button/red");
        assertThat(normalized.event().getEventType()).isEqualTo("button.red.press");
    }

    @Test
    void shouldCategorizeLedStateChangedAsStatusAndNotInternal() {
        String topic = "epld01/events/rpc";
        byte[] payload = """
                {
                  "method":"NotifyStatus",
                  "params":{
                    "switch:0":{"output":true}
                  }
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-28T15:00:00Z"));

        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/led/green");
        assertThat(normalized.event().getEventType()).isEqualTo("led.green.state_changed");
        assertThat(normalized.event().getCategory()).isEqualTo(EventCategory.STATUS);
        assertThat(normalized.event().isInternal()).isFalse();
    }

    @Test
    void shouldNormalizeDeviceLedCommandTopicToCommandEventType() {
        String topic = "epld01/command/led/green";
        byte[] payload = "\"on\"".getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-28T15:00:01Z"));

        assertThat(normalized.event().getDeviceId()).isEqualTo("epld01");
        assertThat(normalized.event().getEventType()).isEqualTo("command.led.green");
        assertThat(normalized.event().getCategory()).isEqualTo(EventCategory.COMMAND);
        assertThat(normalized.event().isInternal()).isFalse();
    }

    @Test
    void shouldNormalizeSimpleControlSwitchCommandTopicToCanonicalLedCommand() {
        String topic = "epld01/command/switch:0";
        byte[] payload = "\"on\"".getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-28T15:00:02Z"));

        assertThat(normalized.event().getTopic()).isEqualTo("epld01/command/led/green");
        assertThat(normalized.event().getEventType()).isEqualTo("command.led.green");
        assertThat(normalized.event().getCategory()).isEqualTo(EventCategory.COMMAND);
        assertThat(normalized.event().isInternal()).isFalse();
    }

    @Test
    void shouldNormalizeSimpleControlSwitchStatusTopicToCanonicalLedStatus() {
        String topic = "epld01/status/switch:1";
        byte[] payload = "{\"output\":false}".getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-28T15:00:03Z"));

        assertThat(normalized.event().getTopic()).isEqualTo("epld01/event/led/orange");
        assertThat(normalized.event().getEventType()).isEqualTo("led.orange.state_changed");
        assertThat(normalized.event().getCategory()).isEqualTo(EventCategory.STATUS);
        assertThat(normalized.event().isInternal()).isFalse();
    }

    @Test
    void shouldMarkOnlineEventsAsInternal() {
        String topic = "epld01/online";
        byte[] payload = "true".getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-28T15:00:04Z"));

        assertThat(normalized.event().getTopic()).isEqualTo("epld01/online");
        assertThat(normalized.event().getEventType()).isEqualTo("device.online.changed");
        assertThat(normalized.event().getCategory()).isEqualTo(EventCategory.STATUS);
        assertThat(normalized.event().isInternal()).isTrue();
    }

    @Test
    void shouldMarkStatusSystemEventsAsInternal() {
        String topic = "epld01/events/rpc";
        byte[] payload = """
                {
                  "method":"NotifyStatus",
                  "params":{
                    "sys":{"uptime":123}
                  }
                }
                """.getBytes(StandardCharsets.UTF_8);

        NormalizedEvent normalized = normalizer.normalize(topic, payload, Instant.parse("2026-02-28T15:00:05Z"));

        assertThat(normalized.event().getTopic()).isEqualTo("epld01/status/system");
        assertThat(normalized.event().getEventType()).isEqualTo("status.system");
        assertThat(normalized.event().getCategory()).isEqualTo(EventCategory.STATUS);
        assertThat(normalized.event().isInternal()).isTrue();
    }
}
