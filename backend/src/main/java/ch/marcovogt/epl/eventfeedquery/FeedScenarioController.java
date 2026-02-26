package ch.marcovogt.epl.eventfeedquery;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class FeedScenarioController {

    private final RequestAuth requestAuth;
    private final FeedScenarioService feedScenarioService;
    private final RealtimeSyncService realtimeSyncService;
    private final AdminAuditLogger adminAuditLogger;

    public FeedScenarioController(
            RequestAuth requestAuth,
            FeedScenarioService feedScenarioService,
            RealtimeSyncService realtimeSyncService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.feedScenarioService = feedScenarioService;
        this.realtimeSyncService = realtimeSyncService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping("/scenarios")
    public FeedScenarioConfigDto getScenarioConfig(HttpServletRequest request) {
        requestAuth.requireAny(request);
        return feedScenarioService.getConfig();
    }

    @GetMapping("/admin/scenarios")
    public FeedScenarioConfigDto getAdminScenarioConfig(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return feedScenarioService.getConfig();
    }

    @PostMapping("/admin/scenarios")
    public FeedScenarioConfigDto updateAdminScenarioConfig(
            HttpServletRequest request,
            @Valid @RequestBody UpdateFeedScenarioConfigRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        FeedScenarioConfigDto updated = feedScenarioService.updateConfig(
                body.scenarioOverlays(),
                principal.username()
        );
        realtimeSyncService.broadcastFeedScenarios(updated);
        adminAuditLogger.logAction(
                "admin.feed-scenarios.update",
                principal.username(),
                Map.of("scenarioOverlays", updated.scenarioOverlays())
        );
        return updated;
    }
}
