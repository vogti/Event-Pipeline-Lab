package ch.marcovogt.epl.pipelinebuilder;

import jakarta.validation.constraints.NotNull;

public record StudentPipelineUpdateRequest(
        @NotNull PipelineProcessingSection processing,
        PipelineSinkSection sink
) {
}
