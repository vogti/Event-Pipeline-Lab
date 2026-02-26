package ch.marcovogt.epl.pipelinebuilder;

import java.time.Instant;
import java.util.List;

public record PipelineCompareRowDto(
        String taskId,
        String groupKey,
        long revision,
        Instant updatedAt,
        String updatedBy,
        List<String> slotBlocks
) {
}
