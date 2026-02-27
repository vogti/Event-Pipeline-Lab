package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineSinkSection(
        List<PipelineSinkNode> nodes,
        List<String> targets,
        String goal
) {
}
