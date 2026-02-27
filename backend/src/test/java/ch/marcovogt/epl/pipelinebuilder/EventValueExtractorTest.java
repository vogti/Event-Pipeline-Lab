package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;

import ch.marcovogt.epl.common.EventCategory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EventValueExtractorTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    @Test
    void shouldExtractLedStateAsOnOff() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"output\":true}");

        String value = EventValueExtractor.extractValue(
                EventCategory.STATUS,
                "led.green.state_changed",
                "epld/epld01/event/led/green",
                payload,
                objectMapper
        );

        assertThat(value).isEqualTo("on");
    }

    @Test
    void shouldExtractMqttConnectionState() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"params\":{\"mqtt\":{\"connected\":true}}}");

        String value = EventValueExtractor.extractValue(
                EventCategory.STATUS,
                "status.mqtt",
                "epld01/events/rpc",
                payload,
                objectMapper
        );

        assertThat(value).isEqualTo("true");
    }

    @Test
    void shouldHideTelemetryValue() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"temperature\":23.1}");

        String value = EventValueExtractor.extractValue(
                EventCategory.INTERNAL,
                "sensor.telemetry",
                "epld/epld01/event/telemetry",
                payload,
                objectMapper
        );

        assertThat(value).isEmpty();
    }

    @Test
    void shouldUnwrapNestedEscapedJsonPayloads() throws Exception {
        JsonNode payload = objectMapper.readTree("{\"value\":\"{\\\"output\\\":true}\"}");

        String value = EventValueExtractor.extractValue(
                EventCategory.STATUS,
                "led.orange.state_changed",
                "epld/epld01/event/led/orange",
                payload,
                objectMapper
        );

        assertThat(value).isEqualTo("on");
    }
}
