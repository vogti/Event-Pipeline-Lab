package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;

public record UpdateTaskPipelineConfigRequest(
        @NotBlank String taskId,
        boolean visibleToStudents,
        @Min(4) @Max(6) int slotCount,
        @NotNull @NotEmpty List<String> allowedProcessingBlocks,
        @NotNull List<String> scenarioOverlays,
        @NotNull StudentDeviceScope studentEventVisibilityScope,
        @NotNull StudentDeviceScope studentCommandTargetScope,
        boolean studentSendEventEnabled
) {
}
