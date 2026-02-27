package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineSinkRuntimeSection(
        List<PipelineSinkRuntimeNodeDto> nodes
) {
}
