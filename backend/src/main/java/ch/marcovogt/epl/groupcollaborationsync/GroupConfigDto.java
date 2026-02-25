package ch.marcovogt.epl.groupcollaborationsync;

import java.time.Instant;
import java.util.Map;

public record GroupConfigDto(
        String groupKey,
        Map<String, Object> config,
        long revision,
        Instant updatedAt,
        String updatedBy
) {
}
