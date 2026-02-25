package ch.marcovogt.epl.virtualdevice;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthExceptions;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/student/virtual-device")
public class StudentVirtualDeviceController {

    private final RequestAuth requestAuth;
    private final AppSettingsService appSettingsService;
    private final VirtualDeviceService virtualDeviceService;
    private final RealtimeSyncService realtimeSyncService;

    public StudentVirtualDeviceController(
            RequestAuth requestAuth,
            AppSettingsService appSettingsService,
            VirtualDeviceService virtualDeviceService,
            RealtimeSyncService realtimeSyncService
    ) {
        this.requestAuth = requestAuth;
        this.appSettingsService = appSettingsService;
        this.virtualDeviceService = virtualDeviceService;
        this.realtimeSyncService = realtimeSyncService;
    }

    @GetMapping
    public VirtualDeviceStateDto getVirtualDevice(HttpServletRequest request) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        ensureVisibleForStudents();
        return virtualDeviceService.getByDeviceId(resolveMappedVirtualDeviceId(principal));
    }

    @PostMapping("/control")
    public VirtualDeviceStateDto controlVirtualDevice(
            HttpServletRequest request,
            @Valid @RequestBody VirtualDeviceControlRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        ensureVisibleForStudents();
        VirtualDeviceStateDto updated = virtualDeviceService.applyPatch(resolveMappedVirtualDeviceId(principal), body);
        realtimeSyncService.broadcastVirtualDeviceUpdated(updated);
        return updated;
    }

    private void ensureVisibleForStudents() {
        if (!appSettingsService.isStudentVirtualDeviceVisible()) {
            throw AuthExceptions.forbidden();
        }
    }

    private String resolveMappedVirtualDeviceId(SessionPrincipal principal) {
        String groupKey = principal.groupKey();
        return DeviceIdMapping.virtualDeviceIdForGroup(groupKey)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "No virtual device mapped to group: " + groupKey
                ));
    }
}
