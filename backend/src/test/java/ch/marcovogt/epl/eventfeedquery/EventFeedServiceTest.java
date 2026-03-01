package ch.marcovogt.epl.eventfeedquery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class EventFeedServiceTest {

    @Mock
    private CanonicalEventRepository canonicalEventRepository;

    @Mock
    private AppSettingsService appSettingsService;

    private EventFeedService service;

    @BeforeEach
    void setUp() {
        FeedProperties props = new FeedProperties();
        props.setAdminBufferSize(500);
        service = new EventFeedService(
                canonicalEventRepository,
                new LiveEventBuffer(props),
                new PipelineLiveEventBuffer(props),
                appSettingsService
        );
        lenient().when(appSettingsService.isStudentVirtualDeviceVisible()).thenReturn(true);
    }

    @Test
    void studentAfterPipelineFeedShouldBeScopedToOwnPipelineGroup() {
        service.appendToPipelineLiveBuffer(event("epld01", "epld01/event/button/red", "epld01"));
        service.appendToPipelineLiveBuffer(event("epld02", "epld02/event/button/red", "epld02"));

        SessionPrincipal student = new SessionPrincipal(
                "token",
                "epld01",
                AppRole.STUDENT,
                "epld01",
                "student-a",
                Instant.now().plusSeconds(3600)
        );

        TaskCapabilities capabilities = new TaskCapabilities(
                true,
                true,
                true,
                true,
                true,
                List.of(),
                List.of(),
                StudentDeviceScope.ALL_DEVICES,
                StudentDeviceScope.ALL_DEVICES
        );

        List<CanonicalEventDto> result = service.getFeedForPrincipal(
                student,
                capabilities,
                EventFeedStage.AFTER_PIPELINE,
                100,
                null,
                null,
                true,
                null
        );

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().groupKey()).isEqualTo("epld01");
    }

    @Test
    void adminAfterPipelineFeedShouldContainAllPipelineGroups() {
        service.appendToPipelineLiveBuffer(event("epld01", "epld01/event/button/red", "epld01"));
        service.appendToPipelineLiveBuffer(event("epld02", "epld02/event/button/red", "epld02"));

        SessionPrincipal admin = new SessionPrincipal(
                "token-admin",
                "admin",
                AppRole.ADMIN,
                null,
                "admin",
                Instant.now().plusSeconds(3600)
        );

        TaskCapabilities capabilities = new TaskCapabilities(
                true,
                true,
                true,
                true,
                true,
                List.of(),
                List.of(),
                StudentDeviceScope.ALL_DEVICES,
                StudentDeviceScope.ALL_DEVICES
        );

        List<CanonicalEventDto> result = service.getFeedForPrincipal(
                admin,
                capabilities,
                EventFeedStage.AFTER_PIPELINE,
                100,
                null,
                null,
                true,
                null
        );

        assertThat(result).hasSize(2);
        assertThat(result).extracting(CanonicalEventDto::groupKey).containsExactly("epld02", "epld01");
    }

    private CanonicalEventDto event(String deviceId, String topic, String groupKey) {
        return new CanonicalEventDto(
                UUID.randomUUID(),
                deviceId,
                deviceId,
                topic,
                "button.red.pressed",
                EventCategory.BUTTON,
                "{\"state\":\"pressed\"}",
                null,
                Instant.now(),
                true,
                null,
                false,
                "{}",
                groupKey,
                null
        );
    }
}
