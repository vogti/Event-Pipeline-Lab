package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.mqttgateway.MqttCommandPublisher;
import ch.marcovogt.epl.mqttgateway.PublishSourceContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin/events")
@Validated
public class AdminEventController {

    private final EventFeedService eventFeedService;
    private final RequestAuth requestAuth;
    private final MqttCommandPublisher mqttCommandPublisher;
    private final PublishSourceContext publishSourceContext;
    private final AdminAuditLogger adminAuditLogger;

    public AdminEventController(
            EventFeedService eventFeedService,
            RequestAuth requestAuth,
            MqttCommandPublisher mqttCommandPublisher,
            PublishSourceContext publishSourceContext,
            AdminAuditLogger adminAuditLogger
    ) {
        this.eventFeedService = eventFeedService;
        this.requestAuth = requestAuth;
        this.mqttCommandPublisher = mqttCommandPublisher;
        this.publishSourceContext = publishSourceContext;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public List<CanonicalEventDto> listRecentEvents(
            HttpServletRequest request,
            @RequestParam(name = "limit", defaultValue = "100") @Min(1) @Max(500) int limit,
            @RequestParam(name = "deviceId", required = false) String deviceId,
            @RequestParam(name = "category", required = false) EventCategory category
    ) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return eventFeedService.getRecentEvents(limit, deviceId, category);
    }

    @GetMapping("/live")
    public List<CanonicalEventDto> listLiveBuffer(
            HttpServletRequest request,
            @RequestParam(name = "limit", defaultValue = "100") @Min(1) @Max(500) int limit
    ) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return eventFeedService.getLiveBuffer(limit);
    }

    @PostMapping("/publish")
    public void publishEvent(
            HttpServletRequest request,
            @Valid @RequestBody PublishMqttEventRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        String topic = body.topic().trim();
        String payload = body.payload();
        int qos = body.resolvedQos();
        boolean retained = body.resolvedRetained();

        try {
            publishSourceContext.runWithSource(
                    principal.username(),
                    () -> mqttCommandPublisher.publishCustom(topic, payload, qos, retained)
            );
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage(), ex);
        }

        adminAuditLogger.logAction(
                "admin.events.publish",
                principal.username(),
                Map.of(
                        "topic", topic,
                        "qos", qos,
                        "retained", retained,
                        "payloadSizeBytes", payload.getBytes(StandardCharsets.UTF_8).length
                )
        );
    }
}
