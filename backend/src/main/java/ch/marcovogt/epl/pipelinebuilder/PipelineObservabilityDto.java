package ch.marcovogt.epl.pipelinebuilder;

import java.time.Instant;
import java.util.List;

public record PipelineObservabilityDto(
        int sampleEvery,
        int maxSamplesPerBlock,
        long observedEvents,
        String statePersistenceMode,
        long restartCount,
        Instant lastRestartAt,
        String lastRestartMode,
        List<PipelineBlockObservabilityDto> blocks
) {
}
