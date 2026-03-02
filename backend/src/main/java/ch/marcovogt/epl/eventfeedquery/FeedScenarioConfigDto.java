package ch.marcovogt.epl.eventfeedquery;

import java.time.Instant;
import java.util.List;

public record FeedScenarioConfigDto(
        List<String> scenarioOverlays,
        boolean studentDeviceViewDisturbed,
        Instant updatedAt,
        String updatedBy
) {
}
