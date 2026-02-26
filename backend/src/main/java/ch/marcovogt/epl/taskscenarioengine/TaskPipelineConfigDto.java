package ch.marcovogt.epl.taskscenarioengine;

import java.time.Instant;
import java.util.List;

public record TaskPipelineConfigDto(
        String taskId,
        boolean visibleToStudents,
        int slotCount,
        List<String> allowedProcessingBlocks,
        List<String> scenarioOverlays,
        List<String> availableProcessingBlocks,
        int minSlotCount,
        int maxSlotCount,
        boolean lecturerMode,
        boolean overrideActive,
        Instant updatedAt,
        String updatedBy
) {
}
