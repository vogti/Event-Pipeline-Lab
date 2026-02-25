package com.sostiges.epl.admin;

import com.sostiges.epl.common.EventCategory;
import com.sostiges.epl.eventfeedquery.EventFeedService;
import com.sostiges.epl.eventingestionnormalization.CanonicalEventDto;
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

    public AdminEventController(EventFeedService eventFeedService) {
        this.eventFeedService = eventFeedService;
    }

    @GetMapping
    public List<CanonicalEventDto> listRecentEvents(
            @RequestParam(name = "limit", defaultValue = "100") @Min(1) @Max(500) int limit,
            @RequestParam(name = "deviceId", required = false) String deviceId,
            @RequestParam(name = "category", required = false) EventCategory category
    ) {
        return eventFeedService.getRecentEvents(limit, deviceId, category);
    }

    @GetMapping("/live")
    public List<CanonicalEventDto> listLiveBuffer(
            @RequestParam(name = "limit", defaultValue = "100") @Min(1) @Max(500) int limit
    ) {
        return eventFeedService.getLiveBuffer(limit);
    }
}
