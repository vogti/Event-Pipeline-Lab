package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioConfigDto;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioService;
import ch.marcovogt.epl.taskscenarioengine.PipelineTaskConfig;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinition;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class PipelineStateServiceTest {

    @Mock
    private PipelineStateRepository pipelineStateRepository;

    @Mock
    private TaskStateService taskStateService;

    @Mock
    private AuthService authService;

    @Mock
    private PipelineObservabilityService pipelineObservabilityService;

    @Mock
    private PipelineSinkExecutionService pipelineSinkExecutionService;

    @Mock
    private FeedScenarioService feedScenarioService;

    @Mock
    private AppSettingsService appSettingsService;

    private PipelineStateService service;
    private Map<String, PipelineState> states;

    @BeforeEach
    void setUp() {
        service = new PipelineStateService(
                pipelineStateRepository,
                taskStateService,
                authService,
                pipelineObservabilityService,
                pipelineSinkExecutionService,
                feedScenarioService,
                appSettingsService,
                new ObjectMapper()
        );

        states = new HashMap<>();
        lenient().when(pipelineStateRepository.findByTaskIdAndOwnerTypeAndOwnerKey(anyString(), any(), anyString()))
                .thenAnswer(invocation -> Optional.ofNullable(states.get(key(
                        invocation.getArgument(0),
                        invocation.getArgument(1),
                        invocation.getArgument(2)
                ))));
        lenient().when(pipelineStateRepository.save(any(PipelineState.class))).thenAnswer(invocation -> {
            PipelineState state = invocation.getArgument(0);
            states.put(key(state.getTaskId(), state.getOwnerType(), state.getOwnerKey()), state);
            return state;
        });

        lenient().when(taskStateService.getActiveTask()).thenReturn(activeTask());
        lenient().when(taskStateService.currentStudentCapabilities()).thenReturn(activeTask().studentCapabilities());
        lenient().when(authService.listStudentGroupKeys()).thenReturn(List.of("epld01"));
        lenient().when(appSettingsService.getAdminDeviceId()).thenReturn(null);
        lenient().when(feedScenarioService.getConfig()).thenReturn(new FeedScenarioConfigDto(List.of(), Instant.now(), "test"));
        lenient().when(pipelineObservabilityService.snapshot(anyString(), anyString(), any(PipelineProcessingSection.class)))
                .thenReturn(new PipelineObservabilityDto(
                        1,
                        100,
                        0L,
                        "EPHEMERAL",
                        0L,
                        null,
                        null,
                        List.of()
                ));
        lenient().when(pipelineSinkExecutionService.snapshot(anyString(), anyString(), any(PipelineSinkSection.class)))
                .thenReturn(new PipelineSinkRuntimeSection(List.of()));
        lenient().when(pipelineSinkExecutionService.processProjectedEvent(
                        anyString(),
                        anyString(),
                        any(PipelineSinkSection.class),
                        any(CanonicalEventDto.class),
                        any(StudentDeviceScope.class),
                        anyString(),
                        any()
                ))
                .thenReturn(new PipelineSinkRuntimeSection(List.of()));
        lenient().when(pipelineObservabilityService.recordEvent(
                        anyString(),
                        anyString(),
                        any(PipelineProcessingSection.class),
                        any(CanonicalEventDto.class)
                ))
                .thenAnswer(invocation -> {
                    String groupKey = invocation.getArgument(1);
                    CanonicalEventDto event = invocation.getArgument(3);
                    return new CanonicalEventDto(
                            event.id(),
                            event.deviceId(),
                            event.source(),
                            event.topic(),
                            event.eventType(),
                            event.category(),
                            event.payloadJson(),
                            event.deviceTs(),
                            event.ingestTs(),
                            event.valid(),
                            event.validationErrors(),
                            event.isInternal(),
                            event.scenarioFlags(),
                            groupKey,
                            event.sequenceNo()
                    );
                });
    }

    @Test
    void studentSendEventSinkShouldPersistInNonLecturerMode() {
        SessionPrincipal student = new SessionPrincipal(
                "token",
                "epld01",
                AppRole.STUDENT,
                "epld01",
                "student-1",
                Instant.now().plusSeconds(3600)
        );

        PipelineViewDto initial = service.getStudentViewForGroup("epld01");
        assertThat(initial.sink().nodes()).extracting(PipelineSinkNode::type)
                .containsExactly("EVENT_FEED", "SEND_EVENT", "VIRTUAL_SIGNAL");

        PipelineSinkSection updatedSink = new PipelineSinkSection(
                List.of(
                        new PipelineSinkNode("event-feed", "EVENT_FEED", Map.of()),
                        new PipelineSinkNode(
                                "send-event",
                                "SEND_EVENT",
                                Map.of("topic", "epld01/command/led/green", "payload", "", "qos", 1, "retained", false)
                        ),
                        new PipelineSinkNode(
                                "send-event-2",
                                "SEND_EVENT",
                                Map.of("topic", "epld01/command/led/orange", "payload", "", "qos", 1, "retained", false)
                        ),
                        new PipelineSinkNode("virtual-signal", "VIRTUAL_SIGNAL", Map.of())
                ),
                List.of("DEVICE_CONTROL", "VIRTUAL_SIGNAL"),
                "Goal"
        );

        PipelineViewDto updated = service.updateStudentPipeline(student, initial.processing(), updatedSink);
        assertThat(updated.sink().nodes().stream().filter(node -> "SEND_EVENT".equals(node.type())).count())
                .isEqualTo(2L);

        PipelineViewDto reloaded = service.getStudentViewForGroup("epld01");
        assertThat(reloaded.sink().nodes().stream().filter(node -> "SEND_EVENT".equals(node.type())).count())
                .isEqualTo(2L);
    }

    @Test
    void studentUpdateShouldRejectExcessiveSlotCount() {
        SessionPrincipal student = new SessionPrincipal(
                "token",
                "epld01",
                AppRole.STUDENT,
                "epld01",
                "student-1",
                Instant.now().plusSeconds(3600)
        );

        PipelineViewDto initial = service.getStudentViewForGroup("epld01");
        PipelineProcessingSection oversizedProcessing = new PipelineProcessingSection(
                "CONSTRAINED",
                600,
                List.of(new PipelineSlot(0, "FILTER_TOPIC", Map.of("topicFilter", "+/event/#")))
        );

        assertThatThrownBy(() -> service.updateStudentPipeline(student, oversizedProcessing, initial.sink()))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("slotCount exceeds maximum allowed value");
    }

    @Test
    void studentViewShouldCapInjectedTaskScopeSlotCountToConfiguredMaximum() throws Exception {
        List<PipelineSlot> slots = new ArrayList<>();
        slots.add(new PipelineSlot(510, "FILTER_TOPIC", Map.of("topicFilter", "+/event/#")));
        PipelineStatePayload largePayload = new PipelineStatePayload(
                new PipelineInputSection("LIVE_MQTT", "GROUP_DEVICES", List.of(), List.of()),
                new PipelineProcessingSection("CONSTRAINED", 512, slots),
                new PipelineSinkSection(
                        List.of(
                                new PipelineSinkNode("event-feed", "EVENT_FEED", Map.of()),
                                new PipelineSinkNode("virtual-signal", "VIRTUAL_SIGNAL", Map.of())
                        ),
                        List.of("VIRTUAL_SIGNAL"),
                        "Goal"
                )
        );
        PipelineState state = new PipelineState();
        state.setTaskId("task_intro");
        state.setOwnerType(PipelineOwnerType.GROUP);
        state.setOwnerKey("epld01");
        state.setRevision(7L);
        state.setUpdatedAt(Instant.parse("2026-02-28T12:00:00Z"));
        state.setUpdatedBy("test");
        state.setStateJson(new ObjectMapper().writeValueAsString(largePayload));
        states.put(key("task_intro", PipelineOwnerType.GROUP, "epld01"), state);

        PipelineViewDto view = service.getStudentViewForGroup("epld01");

        assertThat(view.processing().slotCount()).isEqualTo(512);
        assertThat(view.processing().slots().stream().mapToInt(PipelineSlot::index).max().orElse(-1)).isEqualTo(511);
        assertThat(view.processing().slots().stream().anyMatch(slot -> slot.index() == 511 && "FILTER_TOPIC".equals(slot.blockType())))
                .isTrue();
    }

    @Test
    void adminViewShouldKeepSinkEditableWhenLecturerModeDisabled() {
        PipelineViewDto adminView = service.getAdminView("epld01");

        assertThat(adminView.permissions().inputEditable()).isFalse();
        assertThat(adminView.permissions().sinkEditable()).isTrue();
    }

    @Test
    void adminUpdateShouldPersistSinkInNonLecturerMode() {
        SessionPrincipal admin = new SessionPrincipal(
                "token-admin",
                "admin",
                AppRole.ADMIN,
                null,
                "admin",
                Instant.now().plusSeconds(3600)
        );

        PipelineViewDto initial = service.getAdminView("epld01");
        assertThat(initial.permissions().sinkEditable()).isTrue();

        PipelineSinkSection updatedSink = new PipelineSinkSection(
                List.of(
                        new PipelineSinkNode("event-feed", "EVENT_FEED", Map.of()),
                        new PipelineSinkNode(
                                "send-event",
                                "SEND_EVENT",
                                Map.of("topic", "epld01/command/led/green", "payload", "", "qos", 1, "retained", false)
                        ),
                        new PipelineSinkNode(
                                "send-event-2",
                                "SEND_EVENT",
                                Map.of("topic", "epld01/command/led/orange", "payload", "", "qos", 1, "retained", false)
                        ),
                        new PipelineSinkNode("virtual-signal", "VIRTUAL_SIGNAL", Map.of())
                ),
                List.of("DEVICE_CONTROL", "VIRTUAL_SIGNAL"),
                "Goal"
        );

        AdminPipelineUpdateRequest request = new AdminPipelineUpdateRequest(
                "epld01",
                initial.input(),
                initial.processing(),
                updatedSink
        );

        PipelineViewDto updated = service.updateAdminState(admin, request);
        assertThat(updated.sink().nodes().stream().filter(node -> "SEND_EVENT".equals(node.type())).count())
                .isEqualTo(2L);

        PipelineViewDto reloaded = service.getAdminView("epld01");
        assertThat(reloaded.sink().nodes().stream().filter(node -> "SEND_EVENT".equals(node.type())).count())
                .isEqualTo(2L);
    }

    @Test
    void ingestRoutingShouldProcessExternalEventsForAllPipelineGroups() {
        when(authService.listStudentGroupKeys()).thenReturn(List.of("epld01", "epld02"));
        when(appSettingsService.getAdminDeviceId()).thenReturn("epld99");

        CanonicalEventDto event = new CanonicalEventDto(
                UUID.randomUUID(),
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
                null,
                null
        );

        List<PipelineEventProcessingResult> results = service.recordObservabilityAndProjectEvents(event);

        assertThat(results).hasSize(3);
        assertThat(results)
                .extracting(result -> result.observabilityUpdate().groupKey())
                .containsExactlyInAnyOrder("epld01", "epld02", "epld99");
        assertThat(results)
                .extracting(result -> result.projectedEvent().groupKey())
                .containsExactlyInAnyOrder("epld01", "epld02", "epld99");
        verify(pipelineObservabilityService, times(3)).recordEvent(
                anyString(),
                anyString(),
                any(PipelineProcessingSection.class),
                any(CanonicalEventDto.class)
        );
    }

    private String key(String taskId, PipelineOwnerType ownerType, String ownerKey) {
        return taskId + "|" + ownerType + "|" + ownerKey;
    }

    private TaskDefinition activeTask() {
        return new TaskDefinition(
                "task_intro",
                "Einführung",
                "Intro",
                "Desc",
                "Desc",
                "Desc",
                "Desc",
                new TaskCapabilities(
                        false,
                        true,
                        false,
                        true,
                        false,
                        List.of(),
                        List.of(),
                        StudentDeviceScope.OWN_DEVICE,
                        StudentDeviceScope.OWN_DEVICE
                ),
                new PipelineTaskConfig(
                        true,
                        false,
                        5,
                        PipelineBlockLibrary.allBlocks(),
                        "LIVE_MQTT",
                        "GROUP_DEVICES",
                        StudentDeviceScope.OWN_DEVICE,
                        StudentDeviceScope.OWN_DEVICE,
                        false,
                        List.of(),
                        List.of(),
                        List.of("DEVICE_CONTROL", "VIRTUAL_SIGNAL"),
                        "Goal"
                )
        );
    }
}
