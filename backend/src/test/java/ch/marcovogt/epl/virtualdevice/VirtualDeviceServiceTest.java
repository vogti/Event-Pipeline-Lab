package ch.marcovogt.epl.virtualdevice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.admin.VirtualDeviceTopicMode;
import ch.marcovogt.epl.mqttgateway.MqttGatewayClient;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class VirtualDeviceServiceTest {

    @Mock
    private VirtualDeviceStateRepository virtualDeviceStateRepository;

    @Mock
    private AppSettingsService appSettingsService;

    @Mock
    private MqttGatewayClient mqttGatewayClient;

    private VirtualDeviceService service;

    @BeforeEach
    void setUp() {
        service = new VirtualDeviceService(
                virtualDeviceStateRepository,
                appSettingsService,
                mqttGatewayClient,
                new ObjectMapper()
        );
    }

    @Test
    void shouldPublishVirtualStateUpdatesToOwnVirtualTopicByDefault() {
        VirtualDeviceState state = createState();
        when(virtualDeviceStateRepository.findById("eplvd02")).thenReturn(Optional.of(state));
        when(virtualDeviceStateRepository.save(any(VirtualDeviceState.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(appSettingsService.getVirtualDeviceTopicMode()).thenReturn(VirtualDeviceTopicMode.OWN_TOPIC);

        service.applyPatch("eplvd02", new VirtualDeviceControlRequest(true, null, null, null, null, null, null, null));

        ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);
        verify(mqttGatewayClient).publish(eq("eplvd02/events/rpc"), payloadCaptor.capture(), eq(1), eq(false));
        assertThat(payloadCaptor.getValue()).contains("\"deviceId\":\"eplvd02\"");
    }

    @Test
    void shouldPublishVirtualStateUpdatesToPhysicalTopicWhenConfigured() {
        VirtualDeviceState state = createState();
        when(virtualDeviceStateRepository.findById("eplvd02")).thenReturn(Optional.of(state));
        when(virtualDeviceStateRepository.save(any(VirtualDeviceState.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(appSettingsService.getVirtualDeviceTopicMode()).thenReturn(VirtualDeviceTopicMode.PHYSICAL_TOPIC);

        service.applyPatch("eplvd02", new VirtualDeviceControlRequest(true, null, null, null, null, null, null, null));

        ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);
        verify(mqttGatewayClient).publish(eq("epld02/events/rpc"), payloadCaptor.capture(), eq(1), eq(false));
        assertThat(payloadCaptor.getValue()).contains("\"deviceId\":\"eplvd02\"");
    }

    private VirtualDeviceState createState() {
        VirtualDeviceState state = new VirtualDeviceState();
        state.setDeviceId("eplvd02");
        state.setGroupKey("epld02");
        state.setOnline(true);
        state.setRssi(0);
        state.setIpAddress("virtual");
        state.setTemperatureC(22.5);
        state.setHumidityPct(46.0);
        state.setBrightness(1.65);
        state.setCounterValue(0);
        state.setButtonRedPressed(false);
        state.setButtonBlackPressed(false);
        state.setLedGreenOn(false);
        state.setLedOrangeOn(false);
        state.setUpdatedAt(Instant.parse("2026-01-01T00:00:00Z"));
        return state;
    }
}
