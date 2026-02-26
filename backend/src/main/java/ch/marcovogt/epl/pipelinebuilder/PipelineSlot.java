package ch.marcovogt.epl.pipelinebuilder;

import java.util.Map;

public record PipelineSlot(
        int index,
        String blockType,
        Map<String, Object> config
) {
}
