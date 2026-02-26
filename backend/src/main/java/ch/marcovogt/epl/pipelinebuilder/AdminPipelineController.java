package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/pipeline")
public class AdminPipelineController {

    private final RequestAuth requestAuth;
    private final PipelineStateService pipelineStateService;
    private final RealtimeSyncService realtimeSyncService;
    private final AuthService authService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminPipelineController(
            RequestAuth requestAuth,
            PipelineStateService pipelineStateService,
            RealtimeSyncService realtimeSyncService,
            AuthService authService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.pipelineStateService = pipelineStateService;
        this.realtimeSyncService = realtimeSyncService;
        this.authService = authService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public PipelineViewDto getPipeline(
            HttpServletRequest request,
            @RequestParam String groupKey
    ) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return pipelineStateService.getAdminView(groupKey);
    }

    @PostMapping
    public PipelineViewDto updatePipeline(
            HttpServletRequest request,
            @Valid @RequestBody AdminPipelineUpdateRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        PipelineViewDto updated = pipelineStateService.updateAdminState(principal, body);

        if (pipelineStateService.activeTaskLecturerMode()) {
            List<PipelineViewDto> groupViews = pipelineStateService.listStudentViewsForGroups(authService.listStudentGroupKeys());
            realtimeSyncService.broadcastPipelineStates(groupViews);
        } else {
            realtimeSyncService.broadcastPipelineState(updated);
        }

        adminAuditLogger.logAction(
                "admin.pipeline.update",
                principal.username(),
                Map.of(
                        "taskId", updated.taskId(),
                        "groupKey", updated.groupKey(),
                        "lecturerMode", updated.permissions().lecturerMode()
                )
        );

        return updated;
    }
}
