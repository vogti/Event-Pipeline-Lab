package ch.marcovogt.epl.realtimewebsocket;

import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.PresenceUserDto;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.groupcollaborationsync.GroupConfigDto;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinition;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class RealtimeSyncService {

    private final StudentWebSocketBroadcaster studentBroadcaster;
    private final AdminWebSocketBroadcaster adminBroadcaster;
    private final TaskStateService taskStateService;
    private final AuthService authService;

    public RealtimeSyncService(
            StudentWebSocketBroadcaster studentBroadcaster,
            AdminWebSocketBroadcaster adminBroadcaster,
            TaskStateService taskStateService,
            AuthService authService
    ) {
        this.studentBroadcaster = studentBroadcaster;
        this.adminBroadcaster = adminBroadcaster;
        this.taskStateService = taskStateService;
        this.authService = authService;
    }

    public void broadcastEventToStudents(CanonicalEventDto eventDto) {
        TaskCapabilities capabilities = taskStateService.currentStudentCapabilities();
        if (capabilities.canViewRoomEvents()) {
            studentBroadcaster.broadcastToAll("event.feed.append", eventDto);
            return;
        }

        String groupKey = eventDto.groupKey();
        if (groupKey != null && !groupKey.isBlank()) {
            studentBroadcaster.broadcastToGroup(groupKey, "event.feed.append", eventDto);
        }
    }

    public void broadcastDeviceStatusToStudents(DeviceStatusDto statusDto) {
        TaskCapabilities capabilities = taskStateService.currentStudentCapabilities();
        if (capabilities.canViewRoomEvents()) {
            studentBroadcaster.broadcastToAll("device.status.updated", statusDto);
            return;
        }

        studentBroadcaster.broadcastToGroup(statusDto.deviceId(), "device.status.updated", statusDto);
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
        studentBroadcaster.broadcastToAll("task.updated", definition);
        for (String groupKey : authService.listStudentGroupKeys()) {
            studentBroadcaster.broadcastToGroup(
                    groupKey,
                    "capabilities.updated",
                    taskStateService.currentStudentCapabilities()
            );
        }
        adminBroadcaster.broadcast("task.updated", definition);
    }
}
