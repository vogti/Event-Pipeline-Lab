package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;

public record PipelineEventProcessingResult(
        PipelineObservabilityUpdateDto observabilityUpdate,
        CanonicalEventDto projectedEvent
) {
}
