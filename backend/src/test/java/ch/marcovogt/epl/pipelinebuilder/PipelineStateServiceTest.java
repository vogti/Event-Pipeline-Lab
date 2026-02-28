package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.admin.AppSettingsService;
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
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PipelineStateServiceTest {

    @Mock
    private PipelineStateRepository pipelineStateRepository;

    @Mock
    private TaskStateService taskStateService;

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
                pipelineObservabilityService,
                pipelineSinkExecutionService,
                feedScenarioService,
                appSettingsService,
                new ObjectMapper()
        );

        states = new HashMap<>();
        when(pipelineStateRepository.findByTaskIdAndOwnerTypeAndOwnerKey(anyString(), any(), anyString()))
                .thenAnswer(invocation -> Optional.ofNullable(states.get(key(
                        invocation.getArgument(0),
                        invocation.getArgument(1),
                        invocation.getArgument(2)
                ))));
        when(pipelineStateRepository.save(any(PipelineState.class))).thenAnswer(invocation -> {
            PipelineState state = invocation.getArgument(0);
            states.put(key(state.getTaskId(), state.getOwnerType(), state.getOwnerKey()), state);
            return state;
        });

        when(taskStateService.getActiveTask()).thenReturn(activeTask());
        when(feedScenarioService.getConfig()).thenReturn(new FeedScenarioConfigDto(List.of(), Instant.now(), "test"));
        when(pipelineObservabilityService.snapshot(anyString(), anyString(), any(PipelineProcessingSection.class)))
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
        when(pipelineSinkExecutionService.snapshot(anyString(), anyString(), any(PipelineSinkSection.class)))
                .thenReturn(new PipelineSinkRuntimeSection(List.of()));
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
