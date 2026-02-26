package ch.marcovogt.epl.eventfeedquery;

import jakarta.validation.constraints.NotNull;
import java.util.List;

public record UpdateFeedScenarioConfigRequest(
        @NotNull List<String> scenarioOverlays
) {
}
