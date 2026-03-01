package ch.marcovogt.epl.realtimewebsocket;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RealtimeSyncServiceTest {

    @Mock
    private StudentWebSocketBroadcaster studentBroadcaster;

    @Mock
    private AdminWebSocketBroadcaster adminBroadcaster;

    @Mock
    private TaskStateService taskStateService;

    @Mock
    private AuthService authService;

    @Mock
    private AppSettingsService appSettingsService;

    private RealtimeSyncService service;

    @BeforeEach
    void setUp() {
        service = new RealtimeSyncService(
                studentBroadcaster,
                adminBroadcaster,
                taskStateService,
                authService,
                appSettingsService
        );
        when(appSettingsService.isStudentVirtualDeviceVisible()).thenReturn(true);
    }

    @Test
    void pipelineEventsShouldBroadcastOnlyToResolvedGroup() {
        CanonicalEventDto event = new CanonicalEventDto(
                UUID.randomUUID(),
                "wikimedia.eventstream",
                "wikimedia.eventstream",
                "wikimedia/dewiki",
                "external.wikimedia.edit",
                EventCategory.SENSOR,
                "{\"title\":\"Example\"}",
                null,
                Instant.now(),
                true,
                null,
                false,
                "{}",
                "epld01",
                null
        );

        service.broadcastPipelineEventToStudents(event);

        verify(studentBroadcaster).broadcastToGroup("epld01", "event.pipeline.append", event);
        verify(studentBroadcaster, never()).broadcastToAll("event.pipeline.append", event);
    }
}
