package ch.marcovogt.epl.mqttgateway;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MqttCommandPublisherTest {

    @Mock
    private MqttGatewayClient mqttGatewayClient;

    private MqttCommandPublisher publisher;

    @BeforeEach
    void setUp() {
        publisher = new MqttCommandPublisher(mqttGatewayClient);
    }

    @Test
    void publishCustomShouldNormalizeLedGreenCommandTopic() {
        publisher.publishCustom("epld01/command/led/green", "\"pressed\"", 1, false);

        verify(mqttGatewayClient).publish("epld/epld01/cmd/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/switch:0", "on", 1, false);
        verify(mqttGatewayClient).publish(
                eq("epld01/rpc"),
                argThat(payload -> payload.contains("\"method\":\"Switch.Set\"")
                        && payload.contains("\"id\":0")
                        && payload.contains("\"on\":true")),
                eq(1),
                eq(false)
        );
    }

    @Test
    void publishCustomShouldNormalizeLedOrangeCommandTopic() {
        publisher.publishCustom("epld/epld01/command/led/orange", "off", 1, false);

        verify(mqttGatewayClient).publish("epld/epld01/cmd/led/orange", "off", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/led/orange", "off", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/switch:1", "off", 1, false);
        verify(mqttGatewayClient).publish(
                eq("epld01/rpc"),
                argThat(payload -> payload.contains("\"method\":\"Switch.Set\"")
                        && payload.contains("\"id\":1")
                        && payload.contains("\"on\":false")),
                eq(1),
                eq(false)
        );
    }

    @Test
    void publishCustomShouldNormalizeCounterResetCommandTopic() {
        publisher.publishCustom("epld01/command/counter/reset", "ignored", 1, false);

        verify(mqttGatewayClient).publish("epld/epld01/cmd/counter/reset", "{}", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/counter/reset", "{}", 1, false);
        verify(mqttGatewayClient).publish(
                eq("epld01/rpc"),
                argThat(payload -> payload.contains("\"method\":\"Input.ResetCounters\"")
                        && payload.contains("\"id\":2")),
                eq(1),
                eq(false)
        );
    }

    @Test
    void publishCustomShouldRejectUnsupportedLedPayload() {
        assertThatThrownBy(() -> publisher.publishCustom("epld01/command/led/green", "banana", 1, false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported LED command payload");
    }

    @Test
    void publishCustomShouldUseRawPublishForNonNormalizedTopics() {
        publisher.publishCustom("epld01/event/button", "{\"button\":\"black\"}", 2, true);

        verify(mqttGatewayClient, times(1))
                .publish("epld01/event/button", "{\"button\":\"black\"}", 2, true);
    }
}
