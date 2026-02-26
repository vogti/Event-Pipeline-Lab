package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineLogReplayResponse(
        String topic,
        String groupKey,
        Long requestedFromOffset,
        Long nextOffset,
        int returnedCount,
        List<PipelineLogReplayRecordDto> records
) {
}

