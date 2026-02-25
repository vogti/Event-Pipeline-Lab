package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
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
@RequestMapping("/api/admin/events")
@Validated
public class AdminEventController {

    private final EventFeedService eventFeedService;
    private final RequestAuth requestAuth;

    public AdminEventController(EventFeedService eventFeedService, RequestAuth requestAuth) {
        this.eventFeedService = eventFeedService;
        this.requestAuth = requestAuth;
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
}
