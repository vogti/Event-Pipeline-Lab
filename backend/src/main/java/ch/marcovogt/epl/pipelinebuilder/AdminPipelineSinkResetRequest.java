package ch.marcovogt.epl.pipelinebuilder;

import jakarta.validation.constraints.NotBlank;

public record AdminPipelineSinkResetRequest(
        @NotBlank String groupKey,
        @NotBlank String sinkId
) {
}
