package ch.marcovogt.epl.pipelinebuilder;

import jakarta.validation.constraints.NotNull;

public record StudentPipelineStateResetRequest(
        @NotNull PipelineStateControlAction action
) {
}

