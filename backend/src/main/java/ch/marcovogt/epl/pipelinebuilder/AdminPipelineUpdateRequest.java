package ch.marcovogt.epl.pipelinebuilder;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record AdminPipelineUpdateRequest(
        @NotBlank String groupKey,
        @NotNull PipelineInputSection input,
        @NotNull PipelineProcessingSection processing,
        @NotNull PipelineSinkSection sink
) {
}
