package ch.marcovogt.epl.deviceregistryhealth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEvent;
import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DeviceStatusServiceTest {

    @Mock
    private DeviceStatusRepository deviceStatusRepository;

    @Mock
    private DeviceDiscoveryProvisioningService deviceDiscoveryProvisioningService;

    @Mock
    private AdminWebSocketBroadcaster adminWebSocketBroadcaster;

    @Mock
    private RealtimeSyncService realtimeSyncService;

    private DeviceStatusService service;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new DeviceStatusService(
                deviceStatusRepository,
                deviceDiscoveryProvisioningService,
                objectMapper,
                adminWebSocketBroadcaster,
                realtimeSyncService,
                Duration.ofSeconds(25)
        );
    }

    @Test
    void shouldNotFlipOfflineDeviceOnlineForCommandEvents() throws Exception {
        DeviceStatus existing = new DeviceStatus("epld01");
        existing.setOnline(false);
        existing.setLastSeen(Instant.parse("2026-02-28T16:00:00Z"));

        when(deviceStatusRepository.findById("epld01")).thenReturn(Optional.of(existing));

        CanonicalEvent commandEvent = createEvent(
                "epld01",
                "epld01/command/led/green",
                "command.led.green",
                Instant.parse("2026-02-28T16:30:00Z")
        );

        DeviceStatus updated = service.upsertFromInbound(commandEvent, objectMapper.readTree("{\"raw\":\"on\"}"), null);

        assertThat(updated).isNotNull();
        assertThat(updated.isOnline()).isFalse();
        assertThat(updated.getLastSeen()).isEqualTo(Instant.parse("2026-02-28T16:00:00Z"));
        verify(deviceStatusRepository, never()).save(any(DeviceStatus.class));
    }

    @Test
    void shouldIgnoreVirtualMirrorPayloadForPhysicalPresence() throws Exception {
        DeviceStatus existing = new DeviceStatus("epld01");
        existing.setOnline(false);
        existing.setLastSeen(Instant.parse("2026-02-28T16:00:00Z"));

        when(deviceStatusRepository.findById("epld01")).thenReturn(Optional.of(existing));

        CanonicalEvent mirrored = createEvent(
                "epld01",
                "epld01/event/led/green",
                "led.green.state_changed",
                Instant.parse("2026-02-28T16:31:00Z")
        );

        DeviceStatus updated = service.upsertFromInbound(
                mirrored,
                objectMapper.readTree("{\"deviceId\":\"eplvd01\",\"params\":{\"switch:0\":{\"output\":true}}}"),
                null
        );

        assertThat(updated).isNotNull();
        assertThat(updated.isOnline()).isFalse();
        assertThat(updated.getLastSeen()).isEqualTo(Instant.parse("2026-02-28T16:00:00Z"));
        verify(deviceStatusRepository, never()).save(any(DeviceStatus.class));
    }

    @Test
    void shouldSetDeviceOnlineForRealInboundEvent() throws Exception {
        DeviceStatus existing = new DeviceStatus("epld01");
        existing.setOnline(false);
        existing.setLastSeen(Instant.parse("2026-02-28T16:00:00Z"));

        when(deviceStatusRepository.findById("epld01")).thenReturn(Optional.of(existing));
        when(deviceStatusRepository.save(any(DeviceStatus.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        Instant ingestTs = Instant.parse("2026-02-28T16:32:00Z");
        CanonicalEvent inbound = createEvent(
                "epld01",
                "epld01/event/button/red",
                "button.red.press",
                ingestTs
        );

        DeviceStatus updated = service.upsertFromInbound(
                inbound,
                objectMapper.readTree("{\"deviceId\":\"epld01\",\"params\":{\"input:0\":{\"state\":true}}}"),
                null
        );

        assertThat(updated).isNotNull();
        assertThat(updated.isOnline()).isTrue();
        assertThat(updated.getLastSeen()).isEqualTo(ingestTs);
        verify(deviceStatusRepository).save(any(DeviceStatus.class));
    }

    @Test
    void shouldNotCreateNewStatusForCommandOnlyEvent() throws Exception {
        when(deviceStatusRepository.findById("epld01")).thenReturn(Optional.empty());

        CanonicalEvent commandEvent = createEvent(
                "epld01",
                "epld01/command/led/green",
                "command.led.green",
                Instant.parse("2026-02-28T16:33:00Z")
        );

        DeviceStatus created = service.upsertFromInbound(commandEvent, objectMapper.readTree("{\"raw\":\"on\"}"), null);

        assertThat(created).isNull();
        verify(deviceStatusRepository, never()).save(any(DeviceStatus.class));
    }

    @Test
    void shouldIgnoreExternalSourceEventsForDeviceStatus() throws Exception {
        CanonicalEvent externalEvent = createEvent(
                "wikimedia.eventstream",
                "ext/wikimedia/recentchange",
                "external.wikimedia.edit",
                Instant.parse("2026-03-01T11:00:00Z")
        );

        DeviceStatus updated = service.upsertFromInbound(externalEvent, objectMapper.readTree("{\"type\":\"edit\"}"), null);

        assertThat(updated).isNull();
        verify(deviceDiscoveryProvisioningService, never()).ensureProvisionedForPhysicalDevice(any(String.class));
    }

    private CanonicalEvent createEvent(String deviceId, String topic, String eventType, Instant ingestTs) {
        CanonicalEvent event = new CanonicalEvent();
        event.setDeviceId(deviceId);
        event.setTopic(topic);
        event.setEventType(eventType);
        event.setIngestTs(ingestTs);
        return event;
    }
}
