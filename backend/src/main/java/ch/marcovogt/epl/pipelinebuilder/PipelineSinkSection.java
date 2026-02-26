package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineSinkSection(
        List<String> targets,
        String goal
) {
}
