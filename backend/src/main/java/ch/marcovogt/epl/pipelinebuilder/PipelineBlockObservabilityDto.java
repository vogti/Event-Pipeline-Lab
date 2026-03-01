package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;
import java.util.Map;

public record PipelineBlockObservabilityDto(
        int slotIndex,
        String blockType,
        String stateType,
        long stateEntryCount,
        Long stateTtlSeconds,
        long stateMemoryBytes,
        long inCount,
        long outCount,
        long dropCount,
        long errorCount,
        double latencyP50Ms,
        double latencyP95Ms,
        int backlogDepth,
        Map<String, Long> dropReasons,
        List<PipelineSampleEventDto> samples,
        long nonInternalInCount,
        long nonInternalOutCount,
        long nonInternalDropCount,
        long nonInternalErrorCount
) {
}
