package ch.marcovogt.epl.mqttgateway;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatus;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MqttCommandPublisherTest {

    @Mock
    private MqttGatewayClient mqttGatewayClient;

    @Mock
    private AuthService authService;

    @Mock
    private AppSettingsService appSettingsService;

    @Mock
    private DeviceStatusRepository deviceStatusRepository;

    @Mock
    private PublishSourceContext publishSourceContext;

    private MqttCommandPublisher publisher;

    @BeforeEach
    void setUp() {
        publisher = new MqttCommandPublisher(
                mqttGatewayClient,
                authService,
                appSettingsService,
                deviceStatusRepository,
                publishSourceContext
        );
        lenient().when(deviceStatusRepository.findAllByOrderByDeviceIdAsc()).thenReturn(List.of());
    }

    @Test
    void publishCustomShouldNormalizeLedGreenCommandTopic() {
        publisher.publishCustom("epld01/command/led/green", "on", 1, false);

        verify(mqttGatewayClient).publish("epld/epld01/cmd/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/led/green", "on", 1, false);
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
    void publishCustomShouldRejectPressedReleasedAliasesForLedPayload() {
        assertThatThrownBy(() -> publisher.publishCustom("epld01/command/led/green", "\"pressed\"", 1, false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported LED command payload");
        assertThatThrownBy(() -> publisher.publishCustom("epld01/command/led/orange", "released", 1, false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported LED command payload");
    }

    @Test
    void publishCustomShouldUseRawPublishForNonNormalizedTopics() {
        publisher.publishCustom("epld01/event/button", "{\"button\":\"black\"}", 2, true);

        verify(mqttGatewayClient, times(1))
                .publish("epld01/event/button", "{\"button\":\"black\"}", 2, true);
    }

    @Test
    void publishCustomShouldFanOutBroadcastLedGreenTopicToAllPhysicalDevices() {
        mockFanOutContext();
        when(authService.listStudentGroupKeys()).thenReturn(List.of("epld01", "epld02"));
        when(appSettingsService.getAdminDeviceId()).thenReturn(null);

        publisher.publishCustom("command/led/green", "on", 1, false);

        verify(mqttGatewayClient).publish("command/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld/epld01/cmd/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld/epld02/cmd/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld02/command/led/green", "on", 1, false);
        verify(publishSourceContext, times(2))
                .runWithSource(eq(PublishedEventSourceTracker.INTERNAL_FANOUT_SOURCE), org.mockito.ArgumentMatchers.any(Runnable.class));
    }

    @Test
    void publishCustomShouldFanOutBroadcastCounterResetTopicToAllPhysicalDevices() {
        mockFanOutContext();
        when(authService.listStudentGroupKeys()).thenReturn(List.of("epld01"));
        when(appSettingsService.getAdminDeviceId()).thenReturn("epld09");

        publisher.publishCustom("command/counter/reset", "{}", 1, false);

        verify(mqttGatewayClient).publish("command/counter/reset", "{}", 1, false);
        verify(mqttGatewayClient).publish("epld/epld01/cmd/counter/reset", "{}", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/counter/reset", "{}", 1, false);
        verify(mqttGatewayClient).publish("epld/epld09/cmd/counter/reset", "{}", 1, false);
        verify(mqttGatewayClient).publish("epld09/command/counter/reset", "{}", 1, false);
    }

    @Test
    void publishCustomShouldFanOutBroadcastUsingDiscoveredPhysicalDevices() {
        mockFanOutContext();
        when(deviceStatusRepository.findAllByOrderByDeviceIdAsc()).thenReturn(List.of(
                new DeviceStatus("epld01"),
                new DeviceStatus("epld02"),
                new DeviceStatus("eplvd02")
        ));
        when(authService.listStudentGroupKeys()).thenReturn(List.of());
        when(appSettingsService.getAdminDeviceId()).thenReturn(null);

        publisher.publishCustom("command/led/green", "on", 1, false);

        verify(mqttGatewayClient).publish("epld/epld01/cmd/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld01/command/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld/epld02/cmd/led/green", "on", 1, false);
        verify(mqttGatewayClient).publish("epld02/command/led/green", "on", 1, false);
        verify(mqttGatewayClient, times(1))
                .publish(eq("epld01/rpc"), argThat(payload -> payload.contains("\"method\":\"Switch.Set\"")), eq(1), eq(false));
        verify(mqttGatewayClient, times(1))
                .publish(eq("epld02/rpc"), argThat(payload -> payload.contains("\"method\":\"Switch.Set\"")), eq(1), eq(false));
    }

    private void mockFanOutContext() {
        doAnswer(invocation -> {
            Runnable action = invocation.getArgument(1);
            action.run();
            return null;
        }).when(publishSourceContext).runWithSource(anyString(), org.mockito.ArgumentMatchers.any(Runnable.class));
    }
}
