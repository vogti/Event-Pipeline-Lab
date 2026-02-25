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
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.mqttgateway.MqttCommandPublisher;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import ch.marcovogt.epl.taskscenarioengine.TaskInfoDto;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
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

    public StudentController(
            RequestAuth requestAuth,
            TaskStateService taskStateService,
            GroupStateService groupStateService,
            EventFeedService eventFeedService,
            AuthService authService,
            AppSettingsService appSettingsService,
            MqttCommandPublisher mqttCommandPublisher,
            RealtimeSyncService realtimeSyncService
    ) {
        this.requestAuth = requestAuth;
        this.taskStateService = taskStateService;
        this.groupStateService = groupStateService;
        this.eventFeedService = eventFeedService;
        this.authService = authService;
        this.appSettingsService = appSettingsService;
        this.mqttCommandPublisher = mqttCommandPublisher;
        this.realtimeSyncService = realtimeSyncService;
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
                50,
                null,
                null,
                false,
                null
        );

        realtimeSyncService.broadcastPresence(principal.groupKey());

        return new StudentBootstrapResponse(
                AuthMeResponse.from(principal),
                activeTask,
                capabilities,
                config,
                presence,
                feed,
                AppSettingsDto.from(appSettingsService.getOrCreate())
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
        if (!principal.groupKey().equals(body.deviceId())) {
            throw AuthExceptions.forbidden();
        }
        if (!capabilities.studentCommandWhitelist().contains(body.command().name())) {
            throw AuthExceptions.forbidden();
        }

        publish(body.command(), body.deviceId(), body.on());
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
}
