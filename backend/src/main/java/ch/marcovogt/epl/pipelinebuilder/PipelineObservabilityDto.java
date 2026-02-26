package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineObservabilityDto(
        int sampleEvery,
        int maxSamplesPerBlock,
        long observedEvents,
        List<PipelineBlockObservabilityDto> blocks
) {
}

