package ch.marcovogt.epl.pipelinebuilder;

import java.time.Instant;

public record PipelineSinkRuntimeNodeDto(
        String sinkId,
        String sinkType,
        long receivedCount,
        Instant lastReceivedAt,
        String lastPayloadPreview
) {
}
