package ch.marcovogt.epl.pipelinebuilder;

import java.time.Instant;

public record PipelineViewDto(
        String taskId,
        String groupKey,
        PipelineInputSection input,
        PipelineProcessingSection processing,
        PipelineSinkSection sink,
        PipelinePermissions permissions,
        PipelineObservabilityDto observability,
        long revision,
        Instant updatedAt,
        String updatedBy
) {
}
