package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusDto;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusService;
import ch.marcovogt.epl.mqttgateway.MqttCommandPublisher;
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
@RequestMapping("/api/admin/devices")
public class AdminDeviceController {

    private final DeviceStatusService deviceStatusService;
    private final MqttCommandPublisher mqttCommandPublisher;
    private final RequestAuth requestAuth;
    private final AdminAuditLogger adminAuditLogger;

    public AdminDeviceController(
            DeviceStatusService deviceStatusService,
            MqttCommandPublisher mqttCommandPublisher,
            RequestAuth requestAuth,
            AdminAuditLogger adminAuditLogger
    ) {
        this.deviceStatusService = deviceStatusService;
        this.mqttCommandPublisher = mqttCommandPublisher;
        this.requestAuth = requestAuth;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public List<DeviceStatusDto> listDevices(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return deviceStatusService.listAll();
    }

    @PostMapping("/{deviceId}/command")
    public void sendDeviceCommand(
            HttpServletRequest request,
            @PathVariable String deviceId,
            @Valid @RequestBody DeviceCommandRequest command
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        switch (command.command()) {
            case LED_GREEN -> mqttCommandPublisher.publishLedGreen(deviceId, command.on() != null && command.on());
            case LED_ORANGE -> mqttCommandPublisher.publishLedOrange(deviceId, command.on() != null && command.on());
            case COUNTER_RESET -> mqttCommandPublisher.publishCounterReset(deviceId);
            default -> throw new IllegalArgumentException("Unsupported command: " + command.command());
        }

        adminAuditLogger.logAction(
                "admin.device.command",
                principal.username(),
                Map.of(
                        "deviceId", deviceId,
                        "command", command.command().name(),
                        "on", command.on()
                )
        );
    }
}
