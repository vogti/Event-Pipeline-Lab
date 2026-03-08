package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioConfigDto;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioService;
import ch.marcovogt.epl.pipelinebuilder.PipelineStateService;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinition;
import ch.marcovogt.epl.taskscenarioengine.TaskInfoDto;
import ch.marcovogt.epl.taskscenarioengine.TaskPipelineConfigDto;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;

@RestController
@RequestMapping("/api/admin")
public class AdminTaskController {

    private final RequestAuth requestAuth;
    private final TaskStateService taskStateService;
    private final RealtimeSyncService realtimeSyncService;
    private final PipelineStateService pipelineStateService;
    private final FeedScenarioService feedScenarioService;
    private final AuthService authService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminTaskController(
            RequestAuth requestAuth,
            TaskStateService taskStateService,
            RealtimeSyncService realtimeSyncService,
            PipelineStateService pipelineStateService,
            FeedScenarioService feedScenarioService,
            AuthService authService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.taskStateService = taskStateService;
        this.realtimeSyncService = realtimeSyncService;
        this.pipelineStateService = pipelineStateService;
        this.feedScenarioService = feedScenarioService;
        this.authService = authService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping("/tasks")
    public List<TaskInfoDto> listTasks(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return taskStateService.listTasksWithActive();
    }

    @PostMapping("/task/activate")
    public TaskInfoDto activateTask(HttpServletRequest request, @Valid @RequestBody ActivateTaskRequest body) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        TaskDefinition active = taskStateService.activateTask(body.taskId(), principal.username());
        FeedScenarioConfigDto scenarioConfig = feedScenarioService.applyPreset(
                active.pipeline().scenarioOverlays(),
                active.pipeline().studentDeviceViewDisturbed(),
                principal.username()
        );
        realtimeSyncService.broadcastTaskAndCapabilities(active);
        realtimeSyncService.broadcastFeedScenarios(scenarioConfig);

        adminAuditLogger.logAction(
                "admin.task.activate",
                principal.username(),
                Map.of(
                        "taskId", active.id(),
                        "scenarioOverlays", scenarioConfig.scenarioOverlays(),
                        "studentDeviceViewDisturbed", scenarioConfig.studentDeviceViewDisturbed()
                )
        );

        return TaskInfoDto.from(active, true);
    }

    @GetMapping("/task-pipeline-config")
    public TaskPipelineConfigDto getTaskPipelineConfig(
            HttpServletRequest request,
            @RequestParam String taskId
    ) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return taskStateService.getTaskPipelineConfig(taskId);
    }

    @PostMapping("/task-pipeline-config")
    public TaskPipelineConfigDto updateTaskPipelineConfig(
            HttpServletRequest request,
            @Valid @RequestBody UpdateTaskPipelineConfigRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        TaskPipelineConfigDto updated = taskStateService.updateTaskPipelineConfig(
                body.taskId(),
                body.visibleToStudents(),
                body.slotCount(),
                body.allowedProcessingBlocks(),
                body.scenarioOverlays(),
                body.studentEventVisibilityScope(),
                body.studentCommandTargetScope(),
                body.studentSendEventEnabled(),
                body.studentDevicePanelVisible(),
                body.studentDeviceViewDisturbed(),
                principal.username()
        );

        adminAuditLogger.logAction(
                "admin.task.pipeline-config.update",
                principal.username(),
                Map.of(
                        "taskId", updated.taskId(),
                        "visibleToStudents", updated.visibleToStudents(),
                        "slotCount", updated.slotCount(),
                        "allowedBlocks", updated.allowedProcessingBlocks(),
                        "scenarioOverlays", updated.scenarioOverlays(),
                        "studentEventVisibilityScope", updated.studentEventVisibilityScope(),
                        "studentCommandTargetScope", updated.studentCommandTargetScope(),
                        "studentSendEventEnabled", updated.studentSendEventEnabled(),
                        "studentDevicePanelVisible", updated.studentDevicePanelVisible(),
                        "studentDeviceViewDisturbed", updated.studentDeviceViewDisturbed()
                )
        );

        if (taskStateService.getActiveTaskInfo().id().equals(updated.taskId())) {
            realtimeSyncService.broadcastTaskAndCapabilities(taskStateService.getActiveTask());
            realtimeSyncService.broadcastPipelineStates(
                    pipelineStateService.listStudentViewsForGroups(authService.listStudentGroupKeys())
            );
        }

        return updated;
    }

    @PostMapping("/task/update")
    public TaskInfoDto updateTaskDetails(
            HttpServletRequest request,
            @Valid @RequestBody UpdateTaskDetailsRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        TaskInfoDto updated = taskStateService.updateTaskDetails(
                body.taskId(),
                body.titleDe(),
                body.titleEn(),
                body.descriptionDe(),
                body.descriptionEn(),
                body.activeDescriptionDe(),
                body.activeDescriptionEn(),
                principal.username()
        );

        adminAuditLogger.logAction(
                "admin.task.details.update",
                principal.username(),
                Map.of(
                        "taskId", updated.id(),
                        "active", updated.active()
                )
        );

        realtimeSyncService.broadcastTaskAndCapabilities(taskStateService.getActiveTask());
        return updated;
    }

    @PostMapping("/task/create")
    public TaskInfoDto createTask(
            HttpServletRequest request,
            @Valid @RequestBody CreateTaskRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        TaskInfoDto created = taskStateService.createTask(
                body.taskId(),
                body.titleDe(),
                body.titleEn(),
                body.descriptionDe(),
                body.descriptionEn(),
                body.activeDescriptionDe(),
                body.activeDescriptionEn(),
                body.templateTaskId(),
                principal.username()
        );

        adminAuditLogger.logAction(
                "admin.task.create",
                principal.username(),
                Map.of(
                        "taskId", created.id(),
                        "templateTaskId", body.templateTaskId() == null ? "" : body.templateTaskId().trim()
                )
        );

        realtimeSyncService.broadcastTaskAndCapabilities(taskStateService.getActiveTask());
        return created;
    }

    @PostMapping("/task/reorder")
    public List<TaskInfoDto> reorderTasks(
            HttpServletRequest request,
            @Valid @RequestBody ReorderTasksRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        List<TaskInfoDto> reordered = taskStateService.reorderTasks(body.taskIds(), principal.username());

        adminAuditLogger.logAction(
                "admin.task.reorder",
                principal.username(),
                Map.of("taskIds", body.taskIds())
        );

        realtimeSyncService.broadcastTaskAndCapabilities(taskStateService.getActiveTask());
        return reordered;
    }

    @PostMapping("/task/delete")
    public List<TaskInfoDto> deleteTask(
            HttpServletRequest request,
            @Valid @RequestBody DeleteTaskRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        String activeBefore = taskStateService.getActiveTaskInfo().id();
        List<TaskInfoDto> remaining = taskStateService.deleteTask(body.taskId(), principal.username());
        TaskDefinition activeAfter = taskStateService.getActiveTask();

        if (!Objects.equals(activeBefore, activeAfter.id())) {
            FeedScenarioConfigDto scenarioConfig = feedScenarioService.applyPreset(
                    activeAfter.pipeline().scenarioOverlays(),
                    activeAfter.pipeline().studentDeviceViewDisturbed(),
                    principal.username()
            );
            realtimeSyncService.broadcastFeedScenarios(scenarioConfig);
        }

        adminAuditLogger.logAction(
                "admin.task.delete",
                principal.username(),
                Map.of(
                        "taskId", body.taskId().trim(),
                        "remainingTasks", remaining.stream().map(TaskInfoDto::id).toList(),
                        "activeTaskId", activeAfter.id()
                )
        );

        realtimeSyncService.broadcastTaskAndCapabilities(activeAfter);
        return remaining;
    }
}
