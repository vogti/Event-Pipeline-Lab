package ch.marcovogt.epl.taskscenarioengine;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

@Service
public class TaskStateService {

    private static final short STATE_ROW_ID = 1;

    private static final TaskCapabilities ADMIN_CAPABILITIES = new TaskCapabilities(
            true,
            true,
            true,
            true,
            List.of("*"),
            List.of("LED_GREEN", "LED_ORANGE", "COUNTER_RESET")
    );

    private final TaskStateRepository taskStateRepository;
    private final TaskCatalog taskCatalog;
    private final TaskPipelineConfigService taskPipelineConfigService;
    private final Clock clock;

    public TaskStateService(
            TaskStateRepository taskStateRepository,
            TaskCatalog taskCatalog,
            TaskPipelineConfigService taskPipelineConfigService
    ) {
        this.taskStateRepository = taskStateRepository;
        this.taskCatalog = taskCatalog;
        this.taskPipelineConfigService = taskPipelineConfigService;
        this.clock = Clock.systemUTC();
    }

    @Transactional(readOnly = true)
    public List<TaskInfoDto> listTasksWithActive() {
        String activeTaskId = getActiveTask().id();
        return taskCatalog.all().stream()
                .map(taskPipelineConfigService::applyOverrides)
                .map(task -> TaskInfoDto.from(task, task.id().equals(activeTaskId)))
                .toList();
    }

    @Transactional(readOnly = true)
    public TaskInfoDto getActiveTaskInfo() {
        TaskDefinition active = getActiveTask();
        return TaskInfoDto.from(active, true);
    }

    @Transactional(readOnly = true)
    public TaskDefinition getActiveTask() {
        TaskDefinition base = taskCatalog.findById(loadOrCreateState().getActiveTaskId())
                .orElseGet(() -> taskCatalog.findById(taskCatalog.defaultTaskId()).orElseThrow());
        return taskPipelineConfigService.applyOverrides(base);
    }

    @Transactional
    public TaskDefinition activateTask(String taskId, String actor) {
        TaskDefinition definition = taskCatalog.findById(taskId)
                .orElseThrow(() -> new ResponseStatusException(BAD_REQUEST, "Unknown task id: " + taskId));

        TaskState state = loadOrCreateState();
        state.setActiveTaskId(definition.id());
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(actor);
        taskStateRepository.save(state);
        return taskPipelineConfigService.applyOverrides(definition);
    }

    @Transactional(readOnly = true)
    public TaskCapabilities capabilitiesFor(SessionPrincipal principal) {
        if (principal.role() == AppRole.ADMIN) {
            return ADMIN_CAPABILITIES;
        }
        return getActiveTask().studentCapabilities();
    }

    @Transactional(readOnly = true)
    public TaskCapabilities currentStudentCapabilities() {
        return getActiveTask().studentCapabilities();
    }

    @Transactional(readOnly = true)
    public TaskDefinition getTaskById(String taskId) {
        TaskDefinition base = taskCatalog.findById(taskId)
                .orElseThrow(() -> new ResponseStatusException(BAD_REQUEST, "Unknown task id: " + taskId));
        return taskPipelineConfigService.applyOverrides(base);
    }

    @Transactional
    public TaskPipelineConfigDto updateTaskPipelineConfig(
            String taskId,
            boolean visibleToStudents,
            int slotCount,
            List<String> allowedProcessingBlocks,
            List<String> scenarioOverlays,
            String actor
    ) {
        TaskDefinition baseline = taskCatalog.findById(taskId)
                .orElseThrow(() -> new ResponseStatusException(BAD_REQUEST, "Unknown task id: " + taskId));
        return taskPipelineConfigService.update(
                baseline,
                visibleToStudents,
                slotCount,
                allowedProcessingBlocks,
                scenarioOverlays,
                actor
        );
    }

    @Transactional(readOnly = true)
    public TaskPipelineConfigDto getTaskPipelineConfig(String taskId) {
        TaskDefinition resolved = getTaskById(taskId);
        return taskPipelineConfigService.getConfig(resolved);
    }

    private TaskState loadOrCreateState() {
        return taskStateRepository.findById(STATE_ROW_ID)
                .orElseGet(() -> {
                    TaskState created = new TaskState();
                    created.setId(STATE_ROW_ID);
                    created.setActiveTaskId(taskCatalog.defaultTaskId());
                    created.setUpdatedAt(Instant.now(clock));
                    created.setUpdatedBy("system");
                    return taskStateRepository.save(created);
                });
    }
}
