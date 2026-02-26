package ch.marcovogt.epl.taskscenarioengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class TaskStateServiceTest {

    @Mock
    private TaskStateRepository taskStateRepository;

    @Mock
    private TaskPipelineConfigService taskPipelineConfigService;

    private TaskStateService service;

    @BeforeEach
    void setUp() {
        TaskCatalog taskCatalog = new TaskCatalog();
        service = new TaskStateService(taskStateRepository, taskCatalog, taskPipelineConfigService);
    }

    @Test
    void listTasksWithActiveShouldResolveActiveTaskAndKeepListStable() {
        TaskState state = new TaskState();
        state.setId((short) 1);
        state.setActiveTaskId("task_room_view");
        when(taskStateRepository.findById((short) 1)).thenReturn(Optional.of(state));
        when(taskPipelineConfigService.applyOverrides(any(TaskDefinition.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        List<TaskInfoDto> tasks = service.listTasksWithActive();

        assertThat(tasks).hasSize(4);
        assertThat(tasks).anySatisfy(task -> {
            assertThat(task.id()).isEqualTo("task_room_view");
            assertThat(task.active()).isTrue();
        });
        assertThat(tasks.stream().filter(TaskInfoDto::active)).hasSize(1);
        verify(taskPipelineConfigService, atLeastOnce()).applyOverrides(any(TaskDefinition.class));
    }

    @Test
    void getActiveTaskShouldFallBackToDefaultWhenStatePointsToUnknownTask() {
        TaskState state = new TaskState();
        state.setId((short) 1);
        state.setActiveTaskId("task_unknown");
        when(taskStateRepository.findById((short) 1)).thenReturn(Optional.of(state));
        when(taskPipelineConfigService.applyOverrides(any(TaskDefinition.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        TaskDefinition active = service.getActiveTask();

        assertThat(active.id()).isEqualTo("task_intro");
    }

    @Test
    void updateTaskPipelineConfigShouldPassBaselineTaskToConfigService() {
        TaskPipelineConfigDto expected = new TaskPipelineConfigDto(
                "task_intro",
                true,
                5,
                List.of("ROUTE"),
                List.of("delay:300ms"),
                List.of("ROUTE"),
                4,
                6,
                false,
                true,
                null,
                "admin"
        );
        when(taskPipelineConfigService.update(any(), anyBoolean(), anyInt(), any(), any(), any()))
                .thenReturn(expected);

        TaskPipelineConfigDto result = service.updateTaskPipelineConfig(
                "task_intro",
                true,
                5,
                List.of("ROUTE"),
                List.of("delay:300ms"),
                "admin"
        );

        ArgumentCaptor<TaskDefinition> taskCaptor = ArgumentCaptor.forClass(TaskDefinition.class);
        verify(taskPipelineConfigService).update(taskCaptor.capture(), anyBoolean(), anyInt(), any(), any(), any());
        assertThat(taskCaptor.getValue().id()).isEqualTo("task_intro");
        assertThat(taskCaptor.getValue().pipeline().slotCount()).isEqualTo(5);
        assertThat(result).isEqualTo(expected);
    }

    @Test
    void getTaskByIdShouldRejectUnknownTask() {
        assertThatThrownBy(() -> service.getTaskById("not_existing"))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    ResponseStatusException ex = (ResponseStatusException) error;
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).contains("Unknown task id");
                });
    }
}
