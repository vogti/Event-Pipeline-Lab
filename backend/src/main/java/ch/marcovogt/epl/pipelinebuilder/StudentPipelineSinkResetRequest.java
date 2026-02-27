package ch.marcovogt.epl.pipelinebuilder;

import jakarta.validation.constraints.NotBlank;

public record StudentPipelineSinkResetRequest(
        @NotBlank String sinkId
) {
}
