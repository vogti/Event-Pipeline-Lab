package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineInputSection(
        String mode,
        String deviceScope,
        List<String> ingestFilters,
        List<String> scenarioOverlays
) {
}
