package ch.marcovogt.epl.admin;

import java.time.Instant;

public record GroupResetProgressResponse(
        String groupKey,
        boolean hadProgress,
        int resetPipelineStateRows,
        boolean resetVirtualDevice,
        Instant resetAt
) {

    public static GroupResetProgressResponse noop(String groupKey) {
        return new GroupResetProgressResponse(groupKey, false, 0, false, Instant.now());
    }

    public static GroupResetProgressResponse updated(String groupKey, int resetPipelineStateRows, boolean resetVirtualDevice) {
        return new GroupResetProgressResponse(groupKey, true, resetPipelineStateRows, resetVirtualDevice, Instant.now());
    }
}
