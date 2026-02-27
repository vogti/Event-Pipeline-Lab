package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/student/pipeline")
public class StudentPipelineController {

    private final RequestAuth requestAuth;
    private final PipelineStateService pipelineStateService;
    private final RealtimeSyncService realtimeSyncService;

    public StudentPipelineController(
            RequestAuth requestAuth,
            PipelineStateService pipelineStateService,
            RealtimeSyncService realtimeSyncService
    ) {
        this.requestAuth = requestAuth;
        this.pipelineStateService = pipelineStateService;
        this.realtimeSyncService = realtimeSyncService;
    }

    @GetMapping
    public PipelineViewDto getPipeline(HttpServletRequest request) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        return pipelineStateService.getStudentView(principal);
    }

    @PostMapping
    public PipelineViewDto updatePipeline(
            HttpServletRequest request,
            @Valid @RequestBody StudentPipelineUpdateRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        PipelineViewDto updated = pipelineStateService.updateStudentProcessing(principal, body.processing());
        realtimeSyncService.broadcastPipelineState(updated);
        return updated;
    }

    @PostMapping("/state/reset")
    public PipelineViewDto resetState(
            HttpServletRequest request,
            @Valid @RequestBody StudentPipelineStateResetRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        PipelineViewDto updated = pipelineStateService.resetStudentState(principal, body.action());
        realtimeSyncService.broadcastPipelineState(updated);
        return updated;
    }

    @PostMapping("/sink/reset")
    public PipelineSinkRuntimeUpdateDto resetSinkRuntime(
            HttpServletRequest request,
            @Valid @RequestBody StudentPipelineSinkResetRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        PipelineSinkRuntimeUpdateDto update = pipelineStateService.resetStudentSinkRuntime(principal, body.sinkId());
        realtimeSyncService.broadcastPipelineSinkRuntime(update);
        return update;
    }
}
