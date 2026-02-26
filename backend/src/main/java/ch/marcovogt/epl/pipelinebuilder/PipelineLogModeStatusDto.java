package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineLogModeStatusDto(
        boolean enabled,
        boolean connected,
        boolean kafkaBacked,
        String topic,
        Long earliestOffset,
        Long latestOffset,
        int replayDefaultMaxRecords,
        List<String> featureBadges,
        String message
) {
}

