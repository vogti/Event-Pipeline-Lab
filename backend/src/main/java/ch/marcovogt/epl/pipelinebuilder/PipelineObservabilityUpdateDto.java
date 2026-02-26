package ch.marcovogt.epl.pipelinebuilder;

public record PipelineObservabilityUpdateDto(
        String taskId,
        String groupKey,
        PipelineObservabilityDto observability
) {
}

