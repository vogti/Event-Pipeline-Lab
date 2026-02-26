package ch.marcovogt.epl.pipelinebuilder;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record PipelineStateControlRequest(
        @NotBlank String groupKey,
        @NotNull PipelineStateControlAction action
) {
}

