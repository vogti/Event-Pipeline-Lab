package ch.marcovogt.epl.pipelinebuilder;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record PipelineLogReplayRequest(
        @NotBlank String groupKey,
        Long fromOffset,
        @Min(1) @Max(1000) Integer maxRecords
) {
}

