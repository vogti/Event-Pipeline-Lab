package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.groupcollaborationsync.GroupConfigDto;
import ch.marcovogt.epl.groupcollaborationsync.GroupOverviewDto;
import ch.marcovogt.epl.groupcollaborationsync.GroupStateService;
import ch.marcovogt.epl.pipelinebuilder.PipelineStateService;
import ch.marcovogt.epl.pipelinebuilder.PipelineViewDto;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/groups")
public class AdminGroupController {

    private final RequestAuth requestAuth;
    private final AuthService authService;
    private final GroupStateService groupStateService;
    private final PipelineStateService pipelineStateService;
    private final VirtualDeviceService virtualDeviceService;
    private final RealtimeSyncService realtimeSyncService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminGroupController(
            RequestAuth requestAuth,
            AuthService authService,
            GroupStateService groupStateService,
            PipelineStateService pipelineStateService,
            VirtualDeviceService virtualDeviceService,
            RealtimeSyncService realtimeSyncService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.authService = authService;
        this.groupStateService = groupStateService;
        this.pipelineStateService = pipelineStateService;
        this.virtualDeviceService = virtualDeviceService;
        this.realtimeSyncService = realtimeSyncService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public List<GroupOverviewDto> listGroups(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);

        return authService.listStudentGroupKeys().stream()
                .map(groupKey -> {
                    GroupConfigDto config = groupStateService.getOrCreate(groupKey);
                    var presence = authService.listGroupPresence(groupKey);
                    boolean hasProgress = groupStateService.hasProgress(groupKey)
                            || pipelineStateService.hasGroupProgress(groupKey)
                            || virtualDeviceService.hasGroupProgress(groupKey);
                    return new GroupOverviewDto(groupKey, presence.size(), presence, config, hasProgress);
                })
                .toList();
    }

    @PostMapping("/{groupKey}/reset-progress")
    public GroupResetProgressResponse resetGroupProgress(
            HttpServletRequest request,
            @PathVariable String groupKey
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);

        boolean groupStateProgress = groupStateService.hasProgress(groupKey);
        boolean pipelineProgress = pipelineStateService.hasGroupProgress(groupKey);
        boolean virtualProgress = virtualDeviceService.hasGroupProgress(groupKey);
        boolean hadProgress = groupStateProgress || pipelineProgress || virtualProgress;

        if (!hadProgress) {
            return GroupResetProgressResponse.noop(groupKey);
        }

        GroupConfigDto resetConfig = groupStateService.resetProgress(groupKey, principal.username());
        int resetPipelineStateRows = pipelineStateService.resetGroupProgress(groupKey);
        boolean resetVirtualDevice = virtualProgress && virtualDeviceService.resetGroupProgress(groupKey);

        PipelineViewDto pipelineView = pipelineStateService.getAdminView(groupKey);
        realtimeSyncService.broadcastGroupConfig(resetConfig);
        realtimeSyncService.broadcastPipelineState(pipelineView);
        if (resetVirtualDevice) {
            virtualDeviceService.findByGroupKey(groupKey).ifPresent(realtimeSyncService::broadcastVirtualDeviceUpdated);
        }

        adminAuditLogger.logAction(
                "admin.group.reset-progress",
                principal.username(),
                Map.of(
                        "groupKey", groupKey,
                        "groupStateProgress", groupStateProgress,
                        "pipelineProgress", pipelineProgress,
                        "virtualProgress", virtualProgress,
                        "resetPipelineStateRows", resetPipelineStateRows,
                        "resetVirtualDevice", resetVirtualDevice
                )
        );

        return GroupResetProgressResponse.updated(groupKey, resetPipelineStateRows, resetVirtualDevice);
    }
}
