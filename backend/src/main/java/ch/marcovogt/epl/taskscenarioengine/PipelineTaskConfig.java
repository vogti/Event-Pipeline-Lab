package ch.marcovogt.epl.taskscenarioengine;

import java.util.List;

public record PipelineTaskConfig(
        boolean visibleToStudents,
        boolean lecturerMode,
        int slotCount,
        List<String> allowedProcessingBlocks,
        String inputMode,
        String deviceScope,
        StudentDeviceScope studentEventVisibilityScope,
        StudentDeviceScope studentCommandTargetScope,
        boolean studentSendEventEnabled,
        boolean studentDeviceViewDisturbed,
        List<String> ingestFilters,
        List<String> scenarioOverlays,
        List<String> sinkTargets,
        String sinkGoal
) {
}
