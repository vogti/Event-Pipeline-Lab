package ch.marcovogt.epl.taskscenarioengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.pipelinebuilder.PipelineBlockLibrary;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class TaskPipelineConfigServiceTest {

    @Mock
    private TaskPipelineConfigStateRepository repository;

    private TaskPipelineConfigService service;

    @BeforeEach
    void setUp() {
        service = new TaskPipelineConfigService(repository, new ObjectMapper());
    }

    @Test
    void applyOverridesShouldUseStoredValuesAndNormalizeAllowedBlocks() {
        TaskPipelineConfigState override = new TaskPipelineConfigState();
        override.setTaskId("task_test");
        override.setVisibleToStudents(false);
        override.setSlotCount(6);
        override.setAllowedProcessingBlocksJson("[\"dedup\",\"UNKNOWN\",\"dedup\",\"none\"]");
        override.setScenarioOverlaysJson("[\"delay:400ms\",\"duplicates:12%\"]");
        when(repository.findById("task_test")).thenReturn(Optional.of(override));

        TaskDefinition overridden = service.applyOverrides(baselineTaskDefinition());

        assertThat(overridden.pipeline().visibleToStudents()).isFalse();
        assertThat(overridden.pipeline().slotCount()).isEqualTo(6);
        assertThat(overridden.pipeline().allowedProcessingBlocks()).containsExactly("DEDUP");
        assertThat(overridden.pipeline().scenarioOverlays()).containsExactly("duplicates:12%", "delay:400ms");
        assertThat(overridden.pipeline().lecturerMode()).isTrue();
        assertThat(overridden.pipeline().inputMode()).isEqualTo("LIVE_MQTT");
    }

    @Test
    void applyOverridesShouldFallBackToBaselineBlocksWhenOverrideBlocksAreEmpty() {
        TaskPipelineConfigState override = new TaskPipelineConfigState();
        override.setTaskId("task_test");
        override.setVisibleToStudents(true);
        override.setSlotCount(5);
        override.setAllowedProcessingBlocksJson("[]");
        override.setScenarioOverlaysJson("[]");
        when(repository.findById("task_test")).thenReturn(Optional.of(override));

        TaskDefinition overridden = service.applyOverrides(baselineTaskDefinition());

        assertThat(overridden.pipeline().allowedProcessingBlocks())
                .containsExactly("FILTER_DEVICE", "FILTER_TOPIC", "DEDUP");
        assertThat(overridden.pipeline().scenarioOverlays()).isEmpty();
    }

    @Test
    void applyOverridesShouldKeepBaselineScenariosWhenScenarioOverrideIsMissing() {
        TaskPipelineConfigState override = new TaskPipelineConfigState();
        override.setTaskId("task_test");
        override.setVisibleToStudents(true);
        override.setSlotCount(5);
        override.setAllowedProcessingBlocksJson("[\"route\"]");
        override.setScenarioOverlaysJson(null);
        when(repository.findById("task_test")).thenReturn(Optional.of(override));

        TaskDefinition overridden = service.applyOverrides(taskDefinitionWithBaselineScenario());

        assertThat(overridden.pipeline().scenarioOverlays()).containsExactly("delay:300ms");
    }

    @Test
    void updateShouldPersistAndReturnEffectiveConfig() {
        AtomicReference<TaskPipelineConfigState> stored = new AtomicReference<>();
        when(repository.findById("task_test")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
        when(repository.save(any(TaskPipelineConfigState.class))).thenAnswer(invocation -> {
            TaskPipelineConfigState state = invocation.getArgument(0);
            stored.set(state);
            return state;
        });

        TaskPipelineConfigDto updated = service.update(
                baselineTaskDefinition(),
                false,
                4,
                List.of("filter_rate_limit", "dedup", "dedup"),
                List.of("delay:250ms", "drop:4%"),
                StudentDeviceScope.ALL_DEVICES,
                StudentDeviceScope.ADMIN_DEVICE,
                true,
                "admin"
        );

        assertThat(updated.visibleToStudents()).isFalse();
        assertThat(updated.slotCount()).isEqualTo(4);
        assertThat(updated.allowedProcessingBlocks()).containsExactly("FILTER_RATE_LIMIT", "DEDUP");
        assertThat(updated.scenarioOverlays()).containsExactly("delay:250ms", "drops:4%");
        assertThat(updated.studentEventVisibilityScope()).isEqualTo(StudentDeviceScope.ALL_DEVICES);
        assertThat(updated.studentCommandTargetScope()).isEqualTo(StudentDeviceScope.ADMIN_DEVICE);
        assertThat(updated.studentSendEventEnabled()).isTrue();
        assertThat(updated.overrideActive()).isTrue();
        assertThat(updated.availableProcessingBlocks()).doesNotContain(PipelineBlockLibrary.NONE);
        assertThat(updated.updatedBy()).isEqualTo("admin");
        assertThat(updated.updatedAt()).isNotNull();
    }

    @Test
    void updateShouldNormalizeLegacyFilterDeviceTopicAlias() {
        AtomicReference<TaskPipelineConfigState> stored = new AtomicReference<>();
        when(repository.findById("task_test")).thenAnswer(invocation -> Optional.ofNullable(stored.get()));
        when(repository.save(any(TaskPipelineConfigState.class))).thenAnswer(invocation -> {
            TaskPipelineConfigState state = invocation.getArgument(0);
            stored.set(state);
            return state;
        });

        TaskPipelineConfigDto updated = service.update(
                baselineTaskDefinition(),
                true,
                5,
                List.of("FILTER_DEVICE_TOPIC", "FILTER_TOPIC", "DEDUP"),
                List.of(),
                StudentDeviceScope.OWN_DEVICE,
                StudentDeviceScope.OWN_DEVICE,
                false,
                "admin"
        );

        assertThat(updated.allowedProcessingBlocks())
                .containsExactly("FILTER_DEVICE", "FILTER_TOPIC", "DEDUP");
    }

    @Test
    void updateShouldRejectUnknownBlockTypes() {
        assertThatThrownBy(() -> service.update(
                baselineTaskDefinition(),
                true,
                5,
                List.of("FILTER_TOPIC", "NOT_A_BLOCK"),
                List.of(),
                StudentDeviceScope.OWN_DEVICE,
                StudentDeviceScope.OWN_DEVICE,
                false,
                "admin"
        ))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    ResponseStatusException ex = (ResponseStatusException) error;
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).contains("Unknown block types");
                });
    }

    @Test
    void updateShouldRejectOutOfRangeSlotCount() {
        assertThatThrownBy(() -> service.update(
                baselineTaskDefinition(),
                true,
                7,
                List.of("FILTER_TOPIC"),
                List.of(),
                StudentDeviceScope.OWN_DEVICE,
                StudentDeviceScope.OWN_DEVICE,
                false,
                "admin"
        ))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    ResponseStatusException ex = (ResponseStatusException) error;
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).contains("slotCount out of allowed range");
                });
    }

    private TaskDefinition baselineTaskDefinition() {
        return new TaskDefinition(
                "task_test",
                "Task",
                "Task",
                "Description",
                "Description",
                "Description",
                "Description",
                new TaskCapabilities(
                        false,
                        false,
                        false,
                        false,
                        false,
                        List.of(),
                        List.of(),
                        StudentDeviceScope.OWN_DEVICE,
                        StudentDeviceScope.OWN_DEVICE
                ),
                new PipelineTaskConfig(
                        true,
                        true,
                        5,
                        List.of("FILTER_DEVICE", "FILTER_TOPIC", "DEDUP"),
                        "LIVE_MQTT",
                        "GROUP_DEVICES",
                        StudentDeviceScope.OWN_DEVICE,
                        StudentDeviceScope.OWN_DEVICE,
                        false,
                        List.of(),
                        List.of(),
                        List.of("DEVICE_CONTROL"),
                        "Goal"
                )
        );
    }

    private TaskDefinition taskDefinitionWithBaselineScenario() {
        return new TaskDefinition(
                "task_test",
                "Task",
                "Task",
                "Description",
                "Description",
                "Description",
                "Description",
                new TaskCapabilities(
                        false,
                        false,
                        false,
                        false,
                        false,
                        List.of(),
                        List.of(),
                        StudentDeviceScope.OWN_DEVICE,
                        StudentDeviceScope.OWN_DEVICE
                ),
                new PipelineTaskConfig(
                        true,
                        true,
                        5,
                        List.of("FILTER_DEVICE", "FILTER_TOPIC", "DEDUP"),
                        "LIVE_MQTT",
                        "GROUP_DEVICES",
                        StudentDeviceScope.OWN_DEVICE,
                        StudentDeviceScope.OWN_DEVICE,
                        false,
                        List.of(),
                        List.of("delay:300ms"),
                        List.of("DEVICE_CONTROL"),
                        "Goal"
                )
        );
    }
}
