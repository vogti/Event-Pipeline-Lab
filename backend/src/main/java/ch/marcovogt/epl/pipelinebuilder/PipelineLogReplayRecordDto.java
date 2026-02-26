package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import java.time.Instant;

public record PipelineLogReplayRecordDto(
        int partition,
        long offset,
        Instant timestamp,
        CanonicalEventDto event
) {
}

