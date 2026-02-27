package ch.marcovogt.epl.eventfeedquery;

import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/events/feed")
@Validated
public class EventFeedController {

    private final RequestAuth requestAuth;
    private final EventFeedService eventFeedService;
    private final TaskStateService taskStateService;

    public EventFeedController(
            RequestAuth requestAuth,
            EventFeedService eventFeedService,
            TaskStateService taskStateService
    ) {
        this.requestAuth = requestAuth;
        this.eventFeedService = eventFeedService;
        this.taskStateService = taskStateService;
    }

    @GetMapping
    public List<CanonicalEventDto> getFeed(
            HttpServletRequest request,
            @RequestParam(name = "limit", defaultValue = "100") @Min(1) @Max(500) int limit,
            @RequestParam(name = "topicContains", required = false) String topicContains,
            @RequestParam(name = "category", required = false) EventCategory category,
            @RequestParam(name = "includeInternal", required = false) Boolean includeInternal,
            @RequestParam(name = "deviceId", required = false) String deviceId,
            @RequestParam(name = "stage", defaultValue = "BEFORE_PIPELINE") EventFeedStage stage
    ) {
        SessionPrincipal principal = requestAuth.requireAny(request);
        TaskCapabilities capabilities = taskStateService.capabilitiesFor(principal);
        return eventFeedService.getFeedForPrincipal(
                principal,
                capabilities,
                stage,
                limit,
                topicContains,
                category,
                includeInternal,
                deviceId
        );
    }
}
