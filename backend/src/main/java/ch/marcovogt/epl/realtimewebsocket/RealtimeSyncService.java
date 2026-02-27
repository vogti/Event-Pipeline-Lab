package ch.marcovogt.epl.realtimewebsocket;

import ch.marcovogt.epl.admin.AppSettingsDto;
import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.PresenceUserDto;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusDto;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioConfigDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.groupcollaborationsync.GroupConfigDto;
import ch.marcovogt.epl.pipelinebuilder.PipelineObservabilityUpdateDto;
import ch.marcovogt.epl.pipelinebuilder.PipelineViewDto;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinition;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceStateDto;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class RealtimeSyncService {

    private final StudentWebSocketBroadcaster studentBroadcaster;
    private final AdminWebSocketBroadcaster adminBroadcaster;
    private final TaskStateService taskStateService;
    private final AuthService authService;
    private final AppSettingsService appSettingsService;

    public RealtimeSyncService(
            StudentWebSocketBroadcaster studentBroadcaster,
            AdminWebSocketBroadcaster adminBroadcaster,
            TaskStateService taskStateService,
            AuthService authService,
            AppSettingsService appSettingsService
    ) {
        this.studentBroadcaster = studentBroadcaster;
        this.adminBroadcaster = adminBroadcaster;
        this.taskStateService = taskStateService;
        this.authService = authService;
        this.appSettingsService = appSettingsService;
    }

    public void broadcastEventToStudents(CanonicalEventDto eventDto) {
        if (!appSettingsService.isStudentVirtualDeviceVisible()
                && DeviceIdMapping.isVirtualDeviceId(eventDto.deviceId())) {
            return;
        }

        TaskCapabilities capabilities = taskStateService.currentStudentCapabilities();
        StudentDeviceScope scope = capabilities.studentEventVisibilityScope() == null
                ? (capabilities.canViewRoomEvents() ? StudentDeviceScope.ALL_DEVICES : StudentDeviceScope.OWN_DEVICE)
                : capabilities.studentEventVisibilityScope();
        if (scope == StudentDeviceScope.ALL_DEVICES) {
            studentBroadcaster.broadcastToAll("event.feed.append", eventDto);
            return;
        }

        if (scope == StudentDeviceScope.ADMIN_DEVICE) {
            String adminDeviceId = appSettingsService.getAdminDeviceId();
            if (adminDeviceId != null && adminDeviceId.equalsIgnoreCase(eventDto.deviceId())) {
                studentBroadcaster.broadcastToAll("event.feed.append", eventDto);
            }
            return;
        }

        String groupKey = resolveGroupKey(eventDto);
        if (groupKey != null) {
            studentBroadcaster.broadcastToGroup(groupKey, "event.feed.append", eventDto);
        }
    }

    public void broadcastPipelineEventToStudents(CanonicalEventDto eventDto) {
        if (!appSettingsService.isStudentVirtualDeviceVisible()
                && DeviceIdMapping.isVirtualDeviceId(eventDto.deviceId())) {
            return;
        }

        TaskCapabilities capabilities = taskStateService.currentStudentCapabilities();
        StudentDeviceScope scope = capabilities.studentEventVisibilityScope() == null
                ? (capabilities.canViewRoomEvents() ? StudentDeviceScope.ALL_DEVICES : StudentDeviceScope.OWN_DEVICE)
                : capabilities.studentEventVisibilityScope();
        if (scope == StudentDeviceScope.ALL_DEVICES) {
            studentBroadcaster.broadcastToAll("event.pipeline.append", eventDto);
            return;
        }

        if (scope == StudentDeviceScope.ADMIN_DEVICE) {
            String adminDeviceId = appSettingsService.getAdminDeviceId();
            if (adminDeviceId != null && adminDeviceId.equalsIgnoreCase(eventDto.deviceId())) {
                studentBroadcaster.broadcastToAll("event.pipeline.append", eventDto);
            }
            return;
        }

        String groupKey = resolveGroupKey(eventDto);
        if (groupKey != null) {
            studentBroadcaster.broadcastToGroup(groupKey, "event.pipeline.append", eventDto);
        }
    }

    public void broadcastDeviceStatusToStudents(DeviceStatusDto statusDto) {
        boolean isVirtualDevice = DeviceIdMapping.isVirtualDeviceId(statusDto.deviceId());
        if (isVirtualDevice && !appSettingsService.isStudentVirtualDeviceVisible()) {
            return;
        }

        TaskCapabilities capabilities = taskStateService.currentStudentCapabilities();
        if (capabilities.canViewRoomEvents()) {
            studentBroadcaster.broadcastToAll("device.status.updated", statusDto);
            return;
        }

        String targetGroupKey = DeviceIdMapping.groupKeyForDevice(statusDto.deviceId()).orElse(statusDto.deviceId());
        studentBroadcaster.broadcastToGroup(targetGroupKey, "device.status.updated", statusDto);
    }

    public void broadcastGroupConfig(GroupConfigDto configDto) {
        studentBroadcaster.broadcastToGroup(configDto.groupKey(), "group.config.updated", configDto);
        adminBroadcaster.broadcast("admin.groups.updated", configDto.groupKey());
    }

    public void broadcastPresence(String groupKey) {
        List<PresenceUserDto> presence = authService.listGroupPresence(groupKey);
        studentBroadcaster.broadcastToGroup(groupKey, "group.presence.updated", presence);
        adminBroadcaster.broadcast("admin.groups.updated", groupKey);
    }

    public void broadcastTaskAndCapabilities(TaskDefinition definition) {
        TaskCapabilities currentStudentCapabilities = taskStateService.currentStudentCapabilities();
        TaskDefinition studentTaskPayload = new TaskDefinition(
                definition.id(),
                definition.titleDe(),
                definition.titleEn(),
                definition.descriptionDe(),
                definition.descriptionEn(),
                currentStudentCapabilities,
                definition.pipeline()
        );
        studentBroadcaster.broadcastToAll("task.updated", studentTaskPayload);
        for (String groupKey : authService.listStudentGroupKeys()) {
            studentBroadcaster.broadcastToGroup(
                    groupKey,
                    "capabilities.updated",
                    currentStudentCapabilities
            );
        }
        adminBroadcaster.broadcast("task.updated", definition);
    }

    public void broadcastSettingsUpdated(AppSettingsDto settingsDto) {
        studentBroadcaster.broadcastToAll("settings.updated", settingsDto);
        adminBroadcaster.broadcast("settings.updated", settingsDto);
    }

    public void broadcastAdminGroupsUpdated() {
        adminBroadcaster.broadcast("admin.groups.updated", "settings");
    }

    public void broadcastFeedScenarios(FeedScenarioConfigDto configDto) {
        studentBroadcaster.broadcastToAll("scenarios.updated", configDto);
        adminBroadcaster.broadcast("scenarios.updated", configDto);
    }

    public void broadcastVirtualDeviceUpdated(VirtualDeviceStateDto deviceDto) {
        adminBroadcaster.broadcast("virtual.device.updated", deviceDto);
        if (!appSettingsService.isStudentVirtualDeviceVisible()) {
            return;
        }
        studentBroadcaster.broadcastToGroup(deviceDto.groupKey(), "virtual.device.updated", deviceDto);
    }

    public void broadcastPipelineState(PipelineViewDto viewDto) {
        studentBroadcaster.broadcastToGroup(viewDto.groupKey(), "pipeline.state.updated", viewDto);
        adminBroadcaster.broadcast("pipeline.state.updated", viewDto);
    }

    public void broadcastPipelineStates(List<PipelineViewDto> views) {
        for (PipelineViewDto view : views) {
            broadcastPipelineState(view);
        }
    }

    public void broadcastPipelineObservability(PipelineObservabilityUpdateDto update) {
        studentBroadcaster.broadcastToGroup(update.groupKey(), "pipeline.observability.updated", update);
        adminBroadcaster.broadcast("pipeline.observability.updated", update);
    }

    private String resolveGroupKey(CanonicalEventDto eventDto) {
        if (eventDto.groupKey() != null && !eventDto.groupKey().isBlank()) {
            return eventDto.groupKey();
        }
        return DeviceIdMapping.groupKeyForDevice(eventDto.deviceId()).orElse(null);
    }
}
