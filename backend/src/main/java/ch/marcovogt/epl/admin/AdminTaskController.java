package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinition;
import ch.marcovogt.epl.taskscenarioengine.TaskInfoDto;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
public class AdminTaskController {

    private final RequestAuth requestAuth;
    private final TaskStateService taskStateService;
    private final RealtimeSyncService realtimeSyncService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminTaskController(
            RequestAuth requestAuth,
            TaskStateService taskStateService,
            RealtimeSyncService realtimeSyncService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.taskStateService = taskStateService;
        this.realtimeSyncService = realtimeSyncService;
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
        realtimeSyncService.broadcastTaskAndCapabilities(active);

        adminAuditLogger.logAction(
                "admin.task.activate",
                principal.username(),
                Map.of("taskId", active.id())
        );

        return TaskInfoDto.from(active, true);
    }
}
