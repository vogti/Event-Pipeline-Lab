package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.deviceregistryhealth.DeviceDiscoveryProvisioningService;
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
@RequestMapping("/api/admin/settings")
public class AdminSettingsController {

    private final RequestAuth requestAuth;
    private final AppSettingsService appSettingsService;
    private final DeviceDiscoveryProvisioningService deviceDiscoveryProvisioningService;
    private final AdminAuditLogger adminAuditLogger;
    private final RealtimeSyncService realtimeSyncService;

    public AdminSettingsController(
            RequestAuth requestAuth,
            AppSettingsService appSettingsService,
            DeviceDiscoveryProvisioningService deviceDiscoveryProvisioningService,
            AdminAuditLogger adminAuditLogger,
            RealtimeSyncService realtimeSyncService
    ) {
        this.requestAuth = requestAuth;
        this.appSettingsService = appSettingsService;
        this.deviceDiscoveryProvisioningService = deviceDiscoveryProvisioningService;
        this.adminAuditLogger = adminAuditLogger;
        this.realtimeSyncService = realtimeSyncService;
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
        AppSettings settings = appSettingsService.update(
                body.defaultLanguageMode(),
                body.timeFormat24h(),
                body.studentVirtualDeviceVisible(),
                body.adminDeviceId(),
                principal.username()
        );
        deviceDiscoveryProvisioningService.reconcileForCurrentSettings();

        adminAuditLogger.logAction(
                "admin.settings.update",
                principal.username(),
                Map.of(
                        "defaultLanguageMode", settings.getDefaultLanguageMode().name(),
                        "timeFormat24h", settings.isTimeFormat24h(),
                        "studentVirtualDeviceVisible", settings.isStudentVirtualDeviceVisible(),
                        "adminDeviceId", settings.getAdminDeviceId() == null ? "" : settings.getAdminDeviceId()
                )
        );

        AppSettingsDto dto = AppSettingsDto.from(settings);
        realtimeSyncService.broadcastSettingsUpdated(dto);
        realtimeSyncService.broadcastAdminGroupsUpdated();
        return dto;
    }
}
