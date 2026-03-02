package ch.marcovogt.epl.eventingestionnormalization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusService;
import ch.marcovogt.epl.deviceregistryhealth.DeviceTelemetryService;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.mqttgateway.PublishedEventSourceTracker;
import ch.marcovogt.epl.pipelinebuilder.PipelineLogModeService;
import ch.marcovogt.epl.pipelinebuilder.PipelineStateService;
import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class EventIngestionServiceTest {

    @Mock
    private CanonicalEventNormalizer canonicalEventNormalizer;

    @Mock
    private CanonicalEventRepository canonicalEventRepository;

    @Mock
    private DeviceStatusService deviceStatusService;

    @Mock
    private DeviceTelemetryService deviceTelemetryService;

    @Mock
    private EventFeedService eventFeedService;

    @Mock
    private AdminWebSocketBroadcaster adminWebSocketBroadcaster;

    @Mock
    private RealtimeSyncService realtimeSyncService;

    @Mock
    private PipelineStateService pipelineStateService;

    @Mock
    private PipelineLogModeService pipelineLogModeService;

    @Mock
    private PublishedEventSourceTracker publishedEventSourceTracker;

    private EventIngestionService service;

    @BeforeEach
    void setUp() {
        service = new EventIngestionService(
                canonicalEventNormalizer,
                canonicalEventRepository,
                deviceStatusService,
                deviceTelemetryService,
                eventFeedService,
                adminWebSocketBroadcaster,
                realtimeSyncService,
                pipelineStateService,
                pipelineLogModeService,
                publishedEventSourceTracker
        );
    }

    @Test
    void ingestShouldSkipInternallyGeneratedFanOutEvents() {
        CanonicalEvent event = new CanonicalEvent();
        event.setDeviceId("epld01");
        when(canonicalEventNormalizer.normalize(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(new NormalizedEvent(event, new ObjectMapper().createObjectNode(), null));
        when(publishedEventSourceTracker.consume(
                org.mockito.ArgumentMatchers.eq("epld01/command/led/green"),
                org.mockito.ArgumentMatchers.eq("on")
        )).thenReturn(PublishedEventSourceTracker.INTERNAL_FANOUT_SOURCE);

        CanonicalEventDto result = service.ingest("epld01/command/led/green", "on".getBytes());

        assertThat(result).isNull();
        verify(canonicalEventRepository, never()).save(org.mockito.ArgumentMatchers.any());
        verify(eventFeedService, never()).appendToLiveBuffer(org.mockito.ArgumentMatchers.any());
        verify(adminWebSocketBroadcaster, never()).broadcastEvent(org.mockito.ArgumentMatchers.any());
        verify(realtimeSyncService, never()).broadcastEventToStudents(org.mockito.ArgumentMatchers.any());
    }
}
