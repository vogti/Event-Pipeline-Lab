package ch.marcovogt.epl.pipelinebuilder;

import java.time.Instant;

public record PipelineSampleEventDto(
        String traceId,
        Instant observedAt,
        Instant ingestTs,
        Instant deviceTs,
        String deviceId,
        String topic,
        String inputEventType,
        String outputEventType,
        boolean dropped,
        String dropReason,
        String inputPayloadJson,
        String outputPayloadJson
) {
}

