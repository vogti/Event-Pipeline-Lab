package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/settings")
public class AdminSettingsController {

    private final RequestAuth requestAuth;
    private final AppSettingsService appSettingsService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminSettingsController(
            RequestAuth requestAuth,
            AppSettingsService appSettingsService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.appSettingsService = appSettingsService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public AppSettingsDto getSettings(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return AppSettingsDto.from(appSettingsService.getOrCreate());
    }

    @PostMapping
    public AppSettingsDto updateSettings(
            HttpServletRequest request,
            @Valid @RequestBody UpdateSettingsRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        AppSettings settings = appSettingsService.update(body.defaultLanguageMode(), principal.username());

        adminAuditLogger.logAction(
                "admin.settings.update",
                principal.username(),
                Map.of("defaultLanguageMode", settings.getDefaultLanguageMode().name())
        );

        return AppSettingsDto.from(settings);
    }
}
