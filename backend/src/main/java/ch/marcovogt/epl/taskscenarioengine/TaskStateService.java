package ch.marcovogt.epl.taskscenarioengine;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
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
    private final TaskDefinitionStateRepository taskDefinitionStateRepository;
    private final TaskPipelineConfigStateRepository taskPipelineConfigStateRepository;
    private final TaskCatalog taskCatalog;
    private final TaskPipelineConfigService taskPipelineConfigService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public TaskStateService(
            TaskStateRepository taskStateRepository,
            TaskDefinitionStateRepository taskDefinitionStateRepository,
            TaskPipelineConfigStateRepository taskPipelineConfigStateRepository,
            TaskCatalog taskCatalog,
            TaskPipelineConfigService taskPipelineConfigService,
            ObjectMapper objectMapper
    ) {
        this.taskStateRepository = taskStateRepository;
        this.taskDefinitionStateRepository = taskDefinitionStateRepository;
        this.taskPipelineConfigStateRepository = taskPipelineConfigStateRepository;
        this.taskCatalog = taskCatalog;
        this.taskPipelineConfigService = taskPipelineConfigService;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional(readOnly = true)
    public List<TaskInfoDto> listTasksWithActive() {
        TaskState state = loadOrCreateState();
        LinkedHashMap<String, TaskDefinition> resolved = resolveTaskDefinitions();
        String activeTaskId = resolveActiveTaskId(state, resolved);
        return resolved.values().stream()
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
        TaskState state = loadOrCreateState();
        LinkedHashMap<String, TaskDefinition> resolved = resolveTaskDefinitions();
        String activeTaskId = resolveActiveTaskId(state, resolved);
        TaskDefinition base = resolved.get(activeTaskId);
        if (base == null) {
            throw new ResponseStatusException(BAD_REQUEST, "No tasks configured");
        }
        return taskPipelineConfigService.applyOverrides(base);
    }

    @Transactional
    public TaskDefinition activateTask(String taskId, String actor) {
        TaskDefinition definition = resolveTaskById(taskId);

        TaskState state = loadOrCreateState();
        state.setActiveTaskId(definition.id());
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(normalizeActor(actor));
        taskStateRepository.save(state);
        return taskPipelineConfigService.applyOverrides(definition);
    }

    @Transactional
    public List<TaskInfoDto> reorderTasks(List<String> taskIds, String actor) {
        LinkedHashMap<String, TaskDefinition> resolved = resolveTaskDefinitions();
        if (resolved.isEmpty()) {
            throw new ResponseStatusException(BAD_REQUEST, "No tasks configured");
        }
        List<String> normalizedOrder = normalizeRequestedOrder(taskIds, resolved.keySet());

        TaskState state = loadOrCreateState();
        state.setTaskOrderJson(serializeJson(normalizedOrder));
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(normalizeActor(actor));
        taskStateRepository.save(state);

        return listTasksWithActive();
    }

    @Transactional
    public List<TaskInfoDto> deleteTask(String taskId, String actor) {
        String normalizedTaskId = normalizeTaskId(taskId);
        LinkedHashMap<String, TaskDefinition> resolved = resolveTaskDefinitions();
        TaskDefinition definition = resolved.get(normalizedTaskId);
        if (definition == null) {
            throw new ResponseStatusException(BAD_REQUEST, "Unknown task id: " + normalizedTaskId);
        }
        if (definition.pipeline().lecturerMode()) {
            throw new ResponseStatusException(BAD_REQUEST, "Lecturer mode tasks cannot be deleted");
        }
        if (resolved.size() <= 1) {
            throw new ResponseStatusException(BAD_REQUEST, "At least one task must remain");
        }

        Instant now = Instant.now(clock);
        String normalizedActor = normalizeActor(actor);

        boolean catalogTask = taskCatalog.findById(normalizedTaskId).isPresent();
        if (catalogTask) {
            TaskDefinitionState state = taskDefinitionStateRepository.findById(normalizedTaskId)
                    .orElseGet(TaskDefinitionState::new);
            state.setTaskId(normalizedTaskId);
            state.setCustomTask(false);
            state.setTitleDe(definition.titleDe());
            state.setTitleEn(definition.titleEn());
            state.setDescriptionDe(definition.descriptionDe());
            state.setDescriptionEn(definition.descriptionEn());
            state.setStudentCapabilitiesJson(null);
            state.setPipelineJson(null);
            state.setDeleted(true);
            state.setUpdatedAt(now);
            state.setUpdatedBy(normalizedActor);
            taskDefinitionStateRepository.save(state);
        } else {
            taskDefinitionStateRepository.deleteById(normalizedTaskId);
        }

        taskPipelineConfigStateRepository.deleteById(normalizedTaskId);

        TaskState taskState = loadOrCreateState();
        List<String> nextOrder = removeTaskFromOrder(
                readTaskOrder(taskState.getTaskOrderJson()),
                normalizedTaskId,
                resolved.keySet()
        );
        taskState.setTaskOrderJson(nextOrder.isEmpty() ? null : serializeJson(nextOrder));

        if (normalizedTaskId.equals(taskState.getActiveTaskId())) {
            String fallbackTaskId = nextOrder.isEmpty()
                    ? resolved.keySet().stream().filter(id -> !id.equals(normalizedTaskId)).findFirst().orElse(null)
                    : nextOrder.get(0);
            if (fallbackTaskId == null || fallbackTaskId.isBlank()) {
                throw new ResponseStatusException(BAD_REQUEST, "No fallback task available after delete");
            }
            taskState.setActiveTaskId(fallbackTaskId);
        }

        taskState.setUpdatedAt(now);
        taskState.setUpdatedBy(normalizedActor);
        taskStateRepository.save(taskState);

        return listTasksWithActive();
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
        TaskDefinition base = resolveTaskById(taskId);
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
        TaskDefinition baseline = resolveTaskById(taskId);
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

    @Transactional
    public TaskInfoDto updateTaskDetails(
            String taskId,
            String titleDe,
            String titleEn,
            String descriptionDe,
            String descriptionEn,
            String actor
    ) {
        String normalizedTaskId = normalizeTaskId(taskId);
        TaskDefinition baseline = resolveTaskById(normalizedTaskId);
        boolean catalogTask = taskCatalog.findById(normalizedTaskId).isPresent();

        TaskDefinitionState state = taskDefinitionStateRepository.findById(normalizedTaskId)
                .orElseGet(TaskDefinitionState::new);
        state.setTaskId(normalizedTaskId);
        state.setCustomTask(!catalogTask || state.isCustomTask());
        state.setTitleDe(normalizeRequiredText(titleDe, "titleDe"));
        state.setTitleEn(normalizeRequiredText(titleEn, "titleEn"));
        state.setDescriptionDe(normalizeRequiredText(descriptionDe, "descriptionDe"));
        state.setDescriptionEn(normalizeRequiredText(descriptionEn, "descriptionEn"));
        state.setDeleted(false);
        if (state.isCustomTask()) {
            state.setStudentCapabilitiesJson(serializeJson(baseline.studentCapabilities()));
            state.setPipelineJson(serializeJson(baseline.pipeline()));
        } else {
            state.setStudentCapabilitiesJson(null);
            state.setPipelineJson(null);
        }
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(normalizeActor(actor));
        taskDefinitionStateRepository.save(state);

        TaskDefinition updated = taskPipelineConfigService.applyOverrides(resolveTaskById(normalizedTaskId));
        return TaskInfoDto.from(updated, updated.id().equals(getActiveTask().id()));
    }

    @Transactional
    public TaskInfoDto createTask(
            String taskId,
            String titleDe,
            String titleEn,
            String descriptionDe,
            String descriptionEn,
            String templateTaskId,
            String actor
    ) {
        String normalizedTaskId = normalizeTaskId(taskId);
        if (resolveTaskDefinitions().containsKey(normalizedTaskId)) {
            throw new ResponseStatusException(BAD_REQUEST, "Task id already exists: " + normalizedTaskId);
        }

        String templateId = hasText(templateTaskId) ? normalizeTaskId(templateTaskId) : getActiveTask().id();
        TaskDefinition template = resolveTaskById(templateId);

        TaskDefinitionState state = new TaskDefinitionState();
        state.setTaskId(normalizedTaskId);
        state.setCustomTask(true);
        state.setTitleDe(normalizeRequiredText(titleDe, "titleDe"));
        state.setTitleEn(normalizeRequiredText(titleEn, "titleEn"));
        state.setDescriptionDe(normalizeRequiredText(descriptionDe, "descriptionDe"));
        state.setDescriptionEn(normalizeRequiredText(descriptionEn, "descriptionEn"));
        state.setStudentCapabilitiesJson(serializeJson(template.studentCapabilities()));
        state.setPipelineJson(serializeJson(template.pipeline()));
        state.setDeleted(false);
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(normalizeActor(actor));
        taskDefinitionStateRepository.save(state);

        TaskState taskState = loadOrCreateState();
        LinkedHashSet<String> nextOrder = new LinkedHashSet<>(readTaskOrder(taskState.getTaskOrderJson()));
        for (String taskKey : resolveTaskDefinitions().keySet()) {
            nextOrder.add(taskKey);
        }
        nextOrder.add(normalizedTaskId);
        taskState.setTaskOrderJson(serializeJson(List.copyOf(nextOrder)));
        taskState.setUpdatedAt(Instant.now(clock));
        taskState.setUpdatedBy(normalizeActor(actor));
        taskStateRepository.save(taskState);

        TaskDefinition created = taskPipelineConfigService.applyOverrides(resolveTaskById(normalizedTaskId));
        return TaskInfoDto.from(created, false);
    }

    private TaskState loadOrCreateState() {
        return taskStateRepository.findById(STATE_ROW_ID)
                .orElseGet(() -> {
                    TaskState created = new TaskState();
                    created.setId(STATE_ROW_ID);
                    created.setActiveTaskId(taskCatalog.defaultTaskId());
                    created.setTaskOrderJson(null);
                    created.setUpdatedAt(Instant.now(clock));
                    created.setUpdatedBy("system");
                    return taskStateRepository.save(created);
                });
    }

    @Transactional(readOnly = true, propagation = Propagation.MANDATORY)
    private LinkedHashMap<String, TaskDefinition> resolveTaskDefinitions() {
        LinkedHashMap<String, TaskDefinition> resolved = new LinkedHashMap<>();
        for (TaskDefinition base : taskCatalog.all()) {
            resolved.put(base.id(), base);
        }

        List<TaskDefinitionState> states = taskDefinitionStateRepository.findAll(
                Sort.by(Sort.Direction.ASC, "taskId")
        );
        for (TaskDefinitionState state : states) {
            if (state.getTaskId() == null || state.getTaskId().isBlank()) {
                continue;
            }

            if (state.isDeleted()) {
                resolved.remove(state.getTaskId());
                continue;
            }

            if (state.isCustomTask()) {
                TaskDefinition custom = customDefinitionFromState(state);
                if (custom != null) {
                    resolved.put(custom.id(), custom);
                }
                continue;
            }

            TaskDefinition existing = resolved.get(state.getTaskId());
            if (existing == null) {
                continue;
            }
            resolved.put(existing.id(), applyMetadataOverride(existing, state));
        }

        TaskState state = taskStateRepository.findById(STATE_ROW_ID).orElse(null);
        return applyTaskOrder(resolved, readTaskOrder(state == null ? null : state.getTaskOrderJson()));
    }

    @Transactional(readOnly = true, propagation = Propagation.MANDATORY)
    private TaskDefinition resolveTaskById(String taskId) {
        TaskDefinition definition = resolveTaskDefinitions().get(taskId);
        if (definition == null) {
            throw new ResponseStatusException(BAD_REQUEST, "Unknown task id: " + taskId);
        }
        return definition;
    }

    private String resolveActiveTaskId(TaskState state, LinkedHashMap<String, TaskDefinition> resolved) {
        if (resolved.isEmpty()) {
            throw new ResponseStatusException(BAD_REQUEST, "No tasks configured");
        }
        String candidate = state.getActiveTaskId();
        if (candidate != null && resolved.containsKey(candidate)) {
            return candidate;
        }
        String defaultTaskId = taskCatalog.defaultTaskId();
        if (resolved.containsKey(defaultTaskId)) {
            return defaultTaskId;
        }
        return resolved.keySet().iterator().next();
    }

    private LinkedHashMap<String, TaskDefinition> applyTaskOrder(
            LinkedHashMap<String, TaskDefinition> resolved,
            List<String> preferredOrder
    ) {
        if (resolved.size() <= 1 || preferredOrder.isEmpty()) {
            return resolved;
        }

        LinkedHashMap<String, TaskDefinition> pool = new LinkedHashMap<>(resolved);
        LinkedHashMap<String, TaskDefinition> ordered = new LinkedHashMap<>();

        for (String taskId : preferredOrder) {
            TaskDefinition definition = pool.remove(taskId);
            if (definition != null) {
                ordered.put(taskId, definition);
            }
        }

        for (var entry : pool.entrySet()) {
            ordered.put(entry.getKey(), entry.getValue());
        }

        return ordered;
    }

    private List<String> readTaskOrder(String taskOrderJson) {
        if (taskOrderJson == null || taskOrderJson.isBlank()) {
            return List.of();
        }
        try {
            @SuppressWarnings("unchecked")
            List<Object> parsed = objectMapper.readValue(taskOrderJson, List.class);
            if (parsed == null || parsed.isEmpty()) {
                return List.of();
            }
            LinkedHashSet<String> normalized = new LinkedHashSet<>();
            for (Object value : parsed) {
                if (!(value instanceof String stringValue)) {
                    continue;
                }
                if (!isValidTaskId(stringValue)) {
                    continue;
                }
                normalized.add(stringValue.trim());
            }
            return List.copyOf(normalized);
        } catch (JsonProcessingException ex) {
            return List.of();
        }
    }

    private List<String> removeTaskFromOrder(List<String> existingOrder, String removedTaskId, Set<String> currentTaskIds) {
        LinkedHashSet<String> next = new LinkedHashSet<>();
        for (String taskId : existingOrder) {
            if (removedTaskId.equals(taskId)) {
                continue;
            }
            if (currentTaskIds.contains(taskId)) {
                next.add(taskId);
            }
        }
        for (String taskId : currentTaskIds) {
            if (!removedTaskId.equals(taskId)) {
                next.add(taskId);
            }
        }
        return List.copyOf(next);
    }

    private List<String> normalizeRequestedOrder(List<String> requestedTaskIds, Set<String> expectedTaskIds) {
        if (requestedTaskIds == null || requestedTaskIds.isEmpty()) {
            throw new ResponseStatusException(BAD_REQUEST, "taskIds must not be empty");
        }

        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String taskId : requestedTaskIds) {
            normalized.add(normalizeTaskId(taskId));
        }
        if (normalized.size() != requestedTaskIds.size()) {
            throw new ResponseStatusException(BAD_REQUEST, "taskIds contains duplicates");
        }

        if (normalized.size() != expectedTaskIds.size()) {
            throw new ResponseStatusException(BAD_REQUEST, "taskIds must include all tasks exactly once");
        }

        for (String expectedTaskId : expectedTaskIds) {
            if (!normalized.contains(expectedTaskId)) {
                throw new ResponseStatusException(BAD_REQUEST, "Missing taskId in reorder payload: " + expectedTaskId);
            }
        }

        return List.copyOf(normalized);
    }

    private TaskDefinition applyMetadataOverride(TaskDefinition base, TaskDefinitionState state) {
        return new TaskDefinition(
                base.id(),
                nonBlankOrDefault(state.getTitleDe(), base.titleDe()),
                nonBlankOrDefault(state.getTitleEn(), base.titleEn()),
                nonBlankOrDefault(state.getDescriptionDe(), base.descriptionDe()),
                nonBlankOrDefault(state.getDescriptionEn(), base.descriptionEn()),
                base.studentCapabilities(),
                base.pipeline()
        );
    }

    private TaskDefinition customDefinitionFromState(TaskDefinitionState state) {
        TaskCapabilities capabilities = parseJson(state.getStudentCapabilitiesJson(), TaskCapabilities.class);
        PipelineTaskConfig pipeline = parseJson(state.getPipelineJson(), PipelineTaskConfig.class);
        if (capabilities == null || pipeline == null) {
            return null;
        }
        String id = normalizeTaskId(state.getTaskId());
        return new TaskDefinition(
                id,
                nonBlankOrDefault(state.getTitleDe(), id),
                nonBlankOrDefault(state.getTitleEn(), id),
                nonBlankOrDefault(state.getDescriptionDe(), id),
                nonBlankOrDefault(state.getDescriptionEn(), id),
                capabilities,
                pipeline
        );
    }

    private String normalizeTaskId(String taskId) {
        if (taskId == null || taskId.isBlank()) {
            throw new ResponseStatusException(BAD_REQUEST, "taskId must not be blank");
        }
        String normalized = taskId.trim();
        if (normalized.length() > 64) {
            throw new ResponseStatusException(BAD_REQUEST, "taskId exceeds max length 64");
        }
        if (!isValidTaskId(normalized)) {
            throw new ResponseStatusException(BAD_REQUEST, "taskId contains invalid characters");
        }
        return normalized;
    }

    private boolean isValidTaskId(String taskId) {
        return taskId != null && taskId.matches("[a-zA-Z0-9_-]+");
    }

    private String normalizeRequiredText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new ResponseStatusException(BAD_REQUEST, fieldName + " must not be blank");
        }
        String normalized = value.trim();
        if (normalized.length() > 8000) {
            throw new ResponseStatusException(BAD_REQUEST, fieldName + " exceeds max length");
        }
        return normalized;
    }

    private String nonBlankOrDefault(String value, String fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        return value.trim();
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private String normalizeActor(String actor) {
        if (actor == null || actor.isBlank()) {
            return "system";
        }
        return actor.trim();
    }

    private <T> T parseJson(String json, Class<T> type) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, type);
        } catch (JsonProcessingException ex) {
            return null;
        }
    }

    private String serializeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new ResponseStatusException(
                    BAD_REQUEST,
                    "Failed to serialize task state: " + ex.getMessage().toLowerCase(Locale.ROOT)
            );
        }
    }
}
