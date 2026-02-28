package ch.marcovogt.epl.taskscenarioengine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
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

    @Mock
    private TaskDefinitionStateRepository taskDefinitionStateRepository;

    @Mock
    private TaskPipelineConfigStateRepository taskPipelineConfigStateRepository;

    private TaskStateService service;

    @BeforeEach
    void setUp() {
        TaskCatalog taskCatalog = new TaskCatalog();
        lenient().when(taskDefinitionStateRepository.findAll(any(org.springframework.data.domain.Sort.class)))
                .thenReturn(List.of());
        service = new TaskStateService(
                taskStateRepository,
                taskDefinitionStateRepository,
                taskPipelineConfigStateRepository,
                taskCatalog,
                taskPipelineConfigService,
                new ObjectMapper()
        );
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
                List.of("DEDUP"),
                List.of("delay:300ms"),
                StudentDeviceScope.OWN_DEVICE,
                StudentDeviceScope.OWN_DEVICE,
                false,
                List.of("DEDUP"),
                4,
                6,
                false,
                true,
                null,
                "admin"
        );
        when(taskPipelineConfigService.update(any(), anyBoolean(), anyInt(), any(), any(), any(), any(), anyBoolean(), any()))
                .thenReturn(expected);

        TaskPipelineConfigDto result = service.updateTaskPipelineConfig(
                "task_intro",
                true,
                5,
                List.of("DEDUP"),
                List.of("delay:300ms"),
                StudentDeviceScope.OWN_DEVICE,
                StudentDeviceScope.OWN_DEVICE,
                false,
                "admin"
        );

        ArgumentCaptor<TaskDefinition> taskCaptor = ArgumentCaptor.forClass(TaskDefinition.class);
        verify(taskPipelineConfigService).update(
                taskCaptor.capture(),
                anyBoolean(),
                anyInt(),
                any(),
                any(),
                any(),
                any(),
                anyBoolean(),
                any()
        );
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

    @Test
    void reorderTasksShouldPersistOrderAndReturnReorderedList() {
        TaskState state = new TaskState();
        state.setId((short) 1);
        state.setActiveTaskId("task_intro");
        when(taskStateRepository.findById((short) 1)).thenReturn(Optional.of(state));
        when(taskPipelineConfigService.applyOverrides(any(TaskDefinition.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        List<TaskInfoDto> reordered = service.reorderTasks(
                List.of("task_commands", "task_intro", "task_room_view", "task_lecturer_mode"),
                "admin"
        );

        assertThat(reordered).extracting(TaskInfoDto::id).containsExactly(
                "task_commands",
                "task_intro",
                "task_room_view",
                "task_lecturer_mode"
        );
        assertThat(state.getTaskOrderJson()).contains("\"task_commands\"");
        verify(taskStateRepository, atLeastOnce()).save(any(TaskState.class));
    }

    @Test
    void deleteTaskShouldRejectLecturerModeTask() {
        TaskState state = new TaskState();
        state.setId((short) 1);
        state.setActiveTaskId("task_intro");
        when(taskStateRepository.findById((short) 1)).thenReturn(Optional.of(state));

        assertThatThrownBy(() -> service.deleteTask("task_lecturer_mode", "admin"))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    ResponseStatusException ex = (ResponseStatusException) error;
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).contains("cannot be deleted");
                });

        verify(taskDefinitionStateRepository, never()).deleteById(any());
        verify(taskPipelineConfigStateRepository, never()).deleteById(any());
    }

    @Test
    void deleteTaskShouldSoftDeleteCatalogTaskAndSwitchActiveTask() {
        TaskState state = new TaskState();
        state.setId((short) 1);
        state.setActiveTaskId("task_commands");
        state.setTaskOrderJson("[\"task_commands\",\"task_intro\",\"task_room_view\",\"task_lecturer_mode\"]");
        when(taskStateRepository.findById((short) 1)).thenReturn(Optional.of(state));
        when(taskPipelineConfigService.applyOverrides(any(TaskDefinition.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(taskDefinitionStateRepository.findById("task_commands")).thenReturn(Optional.empty());
        TaskDefinitionState deletedState = new TaskDefinitionState();
        deletedState.setTaskId("task_commands");
        deletedState.setDeleted(true);
        when(taskDefinitionStateRepository.findAll(any(org.springframework.data.domain.Sort.class)))
                .thenReturn(List.of(), List.of(deletedState), List.of(deletedState));

        List<TaskInfoDto> remaining = service.deleteTask("task_commands", "admin");

        ArgumentCaptor<TaskDefinitionState> stateCaptor = ArgumentCaptor.forClass(TaskDefinitionState.class);
        verify(taskDefinitionStateRepository).save(stateCaptor.capture());
        assertThat(stateCaptor.getValue().getTaskId()).isEqualTo("task_commands");
        assertThat(stateCaptor.getValue().isDeleted()).isTrue();
        verify(taskPipelineConfigStateRepository).deleteById("task_commands");
        assertThat(remaining).extracting(TaskInfoDto::id).doesNotContain("task_commands");
        assertThat(remaining.stream().filter(TaskInfoDto::active))
                .singleElement()
                .extracting(TaskInfoDto::id)
                .isEqualTo("task_intro");
    }

    @Test
    void createTaskShouldAutoGenerateTaskIdWhenMissing() {
        TaskState state = new TaskState();
        state.setId((short) 1);
        state.setActiveTaskId("task_intro");
        AtomicReference<TaskDefinitionState> savedCustomTask = new AtomicReference<>();
        when(taskStateRepository.findById((short) 1)).thenReturn(Optional.of(state));
        when(taskStateRepository.save(any(TaskState.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(taskPipelineConfigService.applyOverrides(any(TaskDefinition.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(taskDefinitionStateRepository.findAll(any(org.springframework.data.domain.Sort.class)))
                .thenAnswer(invocation -> {
                    TaskDefinitionState customTask = savedCustomTask.get();
                    if (customTask == null) {
                        return List.of();
                    }
                    return List.of(customTask);
                });
        when(taskDefinitionStateRepository.save(any(TaskDefinitionState.class)))
                .thenAnswer(invocation -> {
                    TaskDefinitionState customTask = invocation.getArgument(0);
                    savedCustomTask.set(customTask);
                    return customTask;
                });

        TaskInfoDto created = service.createTask(
                null,
                "Neue Aufgabe",
                "New Task",
                "Beschreibung",
                "Description",
                "task_intro",
                "admin"
        );

        assertThat(created.id()).startsWith("task_new-task");
        assertThat(created.id()).matches("[a-zA-Z0-9_-]{1,64}");

        ArgumentCaptor<TaskDefinitionState> stateCaptor = ArgumentCaptor.forClass(TaskDefinitionState.class);
        verify(taskDefinitionStateRepository, atLeastOnce()).save(stateCaptor.capture());
        assertThat(stateCaptor.getValue().getTaskId()).isEqualTo(created.id());
    }
}
