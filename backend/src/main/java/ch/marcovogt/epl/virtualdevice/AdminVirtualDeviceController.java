package ch.marcovogt.epl.virtualdevice;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/virtual-devices")
public class AdminVirtualDeviceController {

    private final RequestAuth requestAuth;
    private final VirtualDeviceService virtualDeviceService;
    private final AdminAuditLogger adminAuditLogger;
    private final RealtimeSyncService realtimeSyncService;

    public AdminVirtualDeviceController(
            RequestAuth requestAuth,
            VirtualDeviceService virtualDeviceService,
            AdminAuditLogger adminAuditLogger,
            RealtimeSyncService realtimeSyncService
    ) {
        this.requestAuth = requestAuth;
        this.virtualDeviceService = virtualDeviceService;
        this.adminAuditLogger = adminAuditLogger;
        this.realtimeSyncService = realtimeSyncService;
    }

    @GetMapping
    public List<VirtualDeviceStateDto> list(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return virtualDeviceService.listAll();
    }

    @PostMapping("/{deviceId}/control")
    public VirtualDeviceStateDto control(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @Valid @RequestBody VirtualDeviceControlRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        VirtualDeviceStateDto updated = virtualDeviceService.applyPatch(deviceId, body);

        adminAuditLogger.logAction(
                "admin.virtual_device.control",
                principal.username(),
                Map.of(
                        "deviceId", deviceId,
                        "groupKey", updated.groupKey()
                )
        );

        realtimeSyncService.broadcastVirtualDeviceUpdated(updated);
        return updated;
    }
}
