package ch.marcovogt.epl.groupcollaborationsync;

import ch.marcovogt.epl.admin.AppSettingsDto;
import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.admin.DeviceCommandType;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthExceptions;
import ch.marcovogt.epl.authsession.AuthMeResponse;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.deviceregistryhealth.DeviceTelemetryService;
import ch.marcovogt.epl.deviceregistryhealth.StudentDeviceStateDto;
import ch.marcovogt.epl.eventfeedquery.EventFeedStage;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.mqttgateway.MqttCommandPublisher;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import ch.marcovogt.epl.taskscenarioengine.TaskInfoDto;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/student")
public class StudentController {

    private final RequestAuth requestAuth;
    private final TaskStateService taskStateService;
    private final GroupStateService groupStateService;
    private final EventFeedService eventFeedService;
    private final AuthService authService;
    private final AppSettingsService appSettingsService;
    private final MqttCommandPublisher mqttCommandPublisher;
    private final RealtimeSyncService realtimeSyncService;
    private final VirtualDeviceService virtualDeviceService;
    private final DeviceTelemetryService deviceTelemetryService;

    public StudentController(
            RequestAuth requestAuth,
            TaskStateService taskStateService,
            GroupStateService groupStateService,
            EventFeedService eventFeedService,
            AuthService authService,
            AppSettingsService appSettingsService,
            MqttCommandPublisher mqttCommandPublisher,
            RealtimeSyncService realtimeSyncService,
            VirtualDeviceService virtualDeviceService,
            DeviceTelemetryService deviceTelemetryService
    ) {
        this.requestAuth = requestAuth;
        this.taskStateService = taskStateService;
        this.groupStateService = groupStateService;
        this.eventFeedService = eventFeedService;
        this.authService = authService;
        this.appSettingsService = appSettingsService;
        this.mqttCommandPublisher = mqttCommandPublisher;
        this.realtimeSyncService = realtimeSyncService;
        this.virtualDeviceService = virtualDeviceService;
        this.deviceTelemetryService = deviceTelemetryService;
    }

    @GetMapping("/bootstrap")
    public StudentBootstrapResponse bootstrap(HttpServletRequest request) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        TaskCapabilities capabilities = taskStateService.capabilitiesFor(principal);

        GroupConfigDto config = groupStateService.getOrCreate(principal.groupKey());
        var presence = authService.listGroupPresence(principal.groupKey());

        TaskInfoDto activeTask = taskStateService.getActiveTaskInfo();

        var feed = eventFeedService.getFeedForPrincipal(
                principal,
                capabilities,
                EventFeedStage.BEFORE_PIPELINE,
                50,
                null,
                null,
                false,
                null
        );

        realtimeSyncService.broadcastPresence(principal.groupKey());

        AppSettingsDto settings = AppSettingsDto.from(appSettingsService.getOrCreate());
        var virtualDevice = settings.studentVirtualDeviceVisible()
                ? virtualDeviceService.findByGroupKey(principal.groupKey()).orElse(null)
                : null;

        return new StudentBootstrapResponse(
                AuthMeResponse.from(principal),
                activeTask,
                capabilities,
                config,
                presence,
                feed,
                virtualDevice,
                settings
        );
    }

    @PostMapping("/config")
    public GroupConfigDto updateConfig(
            HttpServletRequest request,
            @Valid @RequestBody StudentConfigUpdateRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        TaskCapabilities capabilities = taskStateService.capabilitiesFor(principal);
        validateConfigKeys(body, capabilities);

        GroupConfigDto updated = groupStateService.updateConfig(
                principal.groupKey(),
                body.config(),
                principal.displayName()
        );
        realtimeSyncService.broadcastGroupConfig(updated);
        return updated;
    }

    @PostMapping("/command")
    public void sendCommand(
            HttpServletRequest request,
            @Valid @RequestBody StudentCommandRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        TaskCapabilities capabilities = taskStateService.capabilitiesFor(principal);

        if (!capabilities.canSendDeviceCommands()) {
            throw AuthExceptions.forbidden();
        }
        if (!capabilities.studentCommandWhitelist().contains(body.command().name())) {
            throw AuthExceptions.forbidden();
        }

        String targetDeviceId = body.deviceId() == null ? "" : body.deviceId().trim().toLowerCase();
        if (!DeviceIdMapping.isPhysicalDeviceId(targetDeviceId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "deviceId must reference a physical EPLD id");
        }

        StudentDeviceScope targetScope = capabilities.studentCommandTargetScope() == null
                ? StudentDeviceScope.OWN_DEVICE
                : capabilities.studentCommandTargetScope();
        String adminDeviceId = appSettingsService.getAdminDeviceId();
        if (!isAllowedCommandTarget(targetScope, targetDeviceId, principal.groupKey(), adminDeviceId)) {
            throw AuthExceptions.forbidden();
        }

        publish(body.command(), targetDeviceId, body.on());
    }

    @PostMapping("/events/publish")
    public void publishEvent(
            HttpServletRequest request,
            @Valid @RequestBody StudentPublishMqttEventRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        TaskCapabilities capabilities = taskStateService.capabilitiesFor(principal);
        if (!capabilities.studentSendEventEnabled()) {
            throw AuthExceptions.forbidden();
        }

        String topic = body.topic().trim();
        String payload = body.payload();
        int qos = body.resolvedQos();
        boolean retained = body.resolvedRetained();
        String targetDeviceId = body.targetDeviceId() == null ? "" : body.targetDeviceId().trim().toLowerCase(Locale.ROOT);
        if (!DeviceIdMapping.isPhysicalDeviceId(targetDeviceId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "targetDeviceId must reference a physical EPLD id");
        }
        String topicPrefix = extractTopicPrefix(topic);
        if (topicPrefix == null || !targetDeviceId.equalsIgnoreCase(topicPrefix)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "topic prefix must match targetDeviceId");
        }
        StudentDeviceScope targetScope = capabilities.studentCommandTargetScope() == null
                ? StudentDeviceScope.OWN_DEVICE
                : capabilities.studentCommandTargetScope();
        String adminDeviceId = appSettingsService.getAdminDeviceId();
        if (!isAllowedCommandTarget(targetScope, targetDeviceId, principal.groupKey(), adminDeviceId)) {
            throw AuthExceptions.forbidden();
        }
        try {
            mqttCommandPublisher.publishCustom(topic, payload, qos, retained);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage(), ex);
        }
    }

    @GetMapping("/device-state")
    public StudentDeviceStateDto getStudentDeviceState(
            HttpServletRequest request,
            @RequestParam(required = false) String deviceId
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        TaskCapabilities capabilities = taskStateService.capabilitiesFor(principal);

        if (!capabilities.canSendDeviceCommands()) {
            throw AuthExceptions.forbidden();
        }

        String fallbackDeviceId = principal.groupKey() == null ? "" : principal.groupKey();
        String targetDeviceId = (deviceId == null || deviceId.isBlank())
                ? fallbackDeviceId
                : deviceId.trim().toLowerCase();
        if (!DeviceIdMapping.isPhysicalDeviceId(targetDeviceId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "deviceId must reference a physical EPLD id");
        }

        StudentDeviceScope targetScope = capabilities.studentCommandTargetScope() == null
                ? StudentDeviceScope.OWN_DEVICE
                : capabilities.studentCommandTargetScope();
        String adminDeviceId = appSettingsService.getAdminDeviceId();
        if (!isAllowedCommandTarget(targetScope, targetDeviceId, principal.groupKey(), adminDeviceId)) {
            throw AuthExceptions.forbidden();
        }

        return deviceTelemetryService.getStudentDeviceState(targetDeviceId);
    }

    private void validateConfigKeys(StudentConfigUpdateRequest body, TaskCapabilities capabilities) {
        if (body.config() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Config must be a JSON object");
        }

        if (capabilities.allowedConfigOptions().contains("*")) {
            return;
        }

        Set<String> allowed = Set.copyOf(capabilities.allowedConfigOptions());
        for (Map.Entry<String, Object> entry : body.config().entrySet()) {
            String key = entry.getKey();
            if (!allowed.contains(key)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Config option not allowed: " + key);
            }
        }
    }

    private void publish(DeviceCommandType command, String deviceId, Boolean on) {
        switch (command) {
            case LED_GREEN -> mqttCommandPublisher.publishLedGreen(deviceId, on != null && on);
            case LED_ORANGE -> mqttCommandPublisher.publishLedOrange(deviceId, on != null && on);
            case COUNTER_RESET -> mqttCommandPublisher.publishCounterReset(deviceId);
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported command");
        }
    }

    private String extractTopicPrefix(String topic) {
        if (topic == null || topic.isBlank()) {
            return null;
        }
        String normalized = topic.trim();
        int separatorIndex = normalized.indexOf('/');
        String firstSegment = (separatorIndex < 0 ? normalized : normalized.substring(0, separatorIndex))
                .trim()
                .toLowerCase(Locale.ROOT);
        return firstSegment.isEmpty() ? null : firstSegment;
    }

    private boolean isAllowedCommandTarget(
            StudentDeviceScope scope,
            String targetDeviceId,
            String studentGroupKey,
            String adminDeviceId
    ) {
        return switch (scope) {
            case ALL_DEVICES -> true;
            case ADMIN_DEVICE -> adminDeviceId != null && adminDeviceId.equalsIgnoreCase(targetDeviceId);
            case OWN_AND_ADMIN_DEVICE -> {
                boolean isOwn = studentGroupKey != null && studentGroupKey.equalsIgnoreCase(targetDeviceId);
                boolean isAdmin = adminDeviceId != null && adminDeviceId.equalsIgnoreCase(targetDeviceId);
                yield isOwn || isAdmin;
            }
            case OWN_DEVICE -> studentGroupKey != null && studentGroupKey.equalsIgnoreCase(targetDeviceId);
        };
    }
}
