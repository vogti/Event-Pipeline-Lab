package ch.marcovogt.epl.deviceregistryhealth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEvent;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DeviceTelemetryServiceTest {

    @Mock
    private CanonicalEventRepository canonicalEventRepository;

    @Mock
    private DeviceStatusRepository deviceStatusRepository;

    private DeviceTelemetryService service;

    @BeforeEach
    void setUp() {
        service = new DeviceTelemetryService(
                canonicalEventRepository,
                deviceStatusRepository,
                new ObjectMapper()
        );
    }

    @Test
    void shouldNotUpdateGreenLedStateFromRawLedCommandPayload() {
        CanonicalEvent event = new CanonicalEvent();
        event.setDeviceId("epld01");
        event.setTopic("epld01/command/led/green");
        event.setEventType("command.led.green");
        event.setPayloadJson("{\"raw\":\"on\"}");
        event.setIngestTs(Instant.parse("2026-02-28T16:20:00Z"));

        when(deviceStatusRepository.findById("epld01")).thenReturn(Optional.empty());

        service.observeEvent(event);

        StudentDeviceStateDto state = service.getStudentDeviceState("epld01");
        assertThat(state.ledGreenOn()).isNull();
    }

    @Test
    void shouldUpdateOrangeLedStateFromDeviceStatusOutputPayload() {
        CanonicalEvent event = new CanonicalEvent();
        event.setDeviceId("epld01");
        event.setTopic("epld01/event/led/orange");
        event.setEventType("led.orange.state_changed");
        event.setPayloadJson("{\"params\":{\"switch:1\":{\"output\":false}}}");
        event.setIngestTs(Instant.parse("2026-02-28T16:20:01Z"));

        when(deviceStatusRepository.findById("epld01")).thenReturn(Optional.empty());

        service.observeEvent(event);

        StudentDeviceStateDto state = service.getStudentDeviceState("epld01");
        assertThat(state.ledOrangeOn()).isFalse();
    }
}
