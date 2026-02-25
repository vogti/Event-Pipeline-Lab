package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin/system-status")
public class AdminSystemStatusController {

    private final RequestAuth requestAuth;
    private final AdminSystemStatusService adminSystemStatusService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminSystemStatusController(
            RequestAuth requestAuth,
            AdminSystemStatusService adminSystemStatusService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.adminSystemStatusService = adminSystemStatusService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public AdminSystemStatusResponse getStatus(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return adminSystemStatusService.snapshot();
    }

    @PostMapping("/events/reset")
    public ResetEventsResponse resetEvents(
            HttpServletRequest request,
            @Valid @RequestBody ResetEventsRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        if (!Boolean.TRUE.equals(body.confirm())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "confirm must be true");
        }

        ResetEventsResponse reset = adminSystemStatusService.resetEvents();
        adminAuditLogger.logAction(
                "admin.system.events.reset",
                principal.username(),
                Map.of("deletedEvents", reset.deletedEvents())
        );
        return reset;
    }
}
