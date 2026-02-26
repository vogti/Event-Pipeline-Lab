package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;
import java.util.Map;

public record PipelineBlockObservabilityDto(
        int slotIndex,
        String blockType,
        long inCount,
        long outCount,
        long dropCount,
        long errorCount,
        double latencyP50Ms,
        double latencyP95Ms,
        int backlogDepth,
        Map<String, Long> dropReasons,
        List<PipelineSampleEventDto> samples
) {
}

