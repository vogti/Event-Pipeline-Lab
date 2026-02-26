package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
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
    private final PipelineLogModeService pipelineLogModeService;
    private final RealtimeSyncService realtimeSyncService;
    private final AuthService authService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminPipelineController(
            RequestAuth requestAuth,
            PipelineStateService pipelineStateService,
            PipelineLogModeService pipelineLogModeService,
            RealtimeSyncService realtimeSyncService,
            AuthService authService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.pipelineStateService = pipelineStateService;
        this.pipelineLogModeService = pipelineLogModeService;
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

    @GetMapping("/compare")
    public List<PipelineCompareRowDto> comparePipelines(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return pipelineStateService.compareForActiveTask(authService.listStudentGroupKeys());
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

    @PostMapping("/state/control")
    public PipelineViewDto controlState(
            HttpServletRequest request,
            @Valid @RequestBody PipelineStateControlRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        PipelineViewDto updated = pipelineStateService.controlAdminState(body);
        realtimeSyncService.broadcastPipelineState(updated);

        adminAuditLogger.logAction(
                "admin.pipeline.state.control",
                principal.username(),
                Map.of(
                        "taskId", updated.taskId(),
                        "groupKey", updated.groupKey(),
                        "action", body.action().name()
                )
        );

        return updated;
    }

    @GetMapping("/log-mode/status")
    public PipelineLogModeStatusDto logModeStatus(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return pipelineLogModeService.status();
    }

    @PostMapping("/log-mode/replay")
    public PipelineLogReplayResponse replayLogMode(
            HttpServletRequest request,
            @Valid @RequestBody PipelineLogReplayRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        PipelineLogReplayResponse replay = pipelineLogModeService.replay(body.groupKey(), body.fromOffset(), body.maxRecords());

        for (PipelineLogReplayRecordDto record : replay.records()) {
            CanonicalEventDto event = record.event();
            if (event == null) {
                continue;
            }
            PipelineObservabilityUpdateDto update = pipelineStateService.recordObservabilityEvent(event);
            if (update != null) {
                realtimeSyncService.broadcastPipelineObservability(update);
            }
        }

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("groupKey", replay.groupKey());
        details.put("topic", replay.topic());
        details.put("requestedFromOffset", replay.requestedFromOffset());
        details.put("returnedCount", replay.returnedCount());
        details.put("nextOffset", replay.nextOffset());
        adminAuditLogger.logAction("admin.pipeline.log-mode.replay", principal.username(), details);

        return replay;
    }
}
