package ch.marcovogt.epl.externalsources;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin/stream-sources")
public class AdminExternalStreamSourceController {

    private final RequestAuth requestAuth;
    private final ExternalStreamSourceService streamSourceService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminExternalStreamSourceController(
            RequestAuth requestAuth,
            ExternalStreamSourceService streamSourceService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.streamSourceService = streamSourceService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public List<ExternalStreamSourceDto> listSources(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return streamSourceService.listSources();
    }

    @PostMapping("/{sourceId}/enable")
    public ExternalStreamSourceDto enableSource(
            HttpServletRequest request,
            @PathVariable String sourceId
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        ExternalStreamSourceDto updated = wrapBadRequest(
                () -> streamSourceService.setEnabled(sourceId, true, principal.username())
        );
        adminAuditLogger.logAction(
                "admin.stream-source.enable",
                principal.username(),
                Map.of("sourceId", updated.sourceId())
        );
        return updated;
    }

    @PostMapping("/{sourceId}/disable")
    public ExternalStreamSourceDto disableSource(
            HttpServletRequest request,
            @PathVariable String sourceId
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        ExternalStreamSourceDto updated = wrapBadRequest(
                () -> streamSourceService.setEnabled(sourceId, false, principal.username())
        );
        adminAuditLogger.logAction(
                "admin.stream-source.disable",
                principal.username(),
                Map.of("sourceId", updated.sourceId())
        );
        return updated;
    }

    @PostMapping("/{sourceId}/config")
    public ExternalStreamSourceDto updateSourceConfig(
            HttpServletRequest request,
            @PathVariable String sourceId,
            @Valid @RequestBody UpdateExternalStreamSourceConfigRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        ExternalStreamSourceDto updated = wrapBadRequest(
                () -> streamSourceService.updateEndpointUrl(sourceId, body.endpointUrl(), principal.username())
        );
        adminAuditLogger.logAction(
                "admin.stream-source.config.update",
                principal.username(),
                Map.of(
                        "sourceId", updated.sourceId(),
                        "endpointUrl", updated.endpointUrl()
                )
        );
        return updated;
    }

    @PostMapping("/{sourceId}/counter/reset")
    public ExternalStreamSourceDto resetCounter(
            HttpServletRequest request,
            @PathVariable String sourceId
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        ExternalStreamSourceDto updated = wrapBadRequest(
                () -> streamSourceService.resetCounter(sourceId, principal.username())
        );
        adminAuditLogger.logAction(
                "admin.stream-source.counter.reset",
                principal.username(),
                Map.of("sourceId", updated.sourceId())
        );
        return updated;
    }

    private ExternalStreamSourceDto wrapBadRequest(StreamSourceAction action) {
        try {
            return action.run();
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage(), ex);
        }
    }

    @FunctionalInterface
    private interface StreamSourceAction {
        ExternalStreamSourceDto run();
    }
}
