package ch.marcovogt.epl.pipelinebuilder;

import java.util.Map;

public record PipelineSinkNode(
        String id,
        String type,
        Map<String, Object> config
) {
}
