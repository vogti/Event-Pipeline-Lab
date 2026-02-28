package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotBlank;

public record CreateTaskRequest(
        String taskId,
        @NotBlank String titleDe,
        @NotBlank String titleEn,
        @NotBlank String descriptionDe,
        @NotBlank String descriptionEn,
        @NotBlank String activeDescriptionDe,
        @NotBlank String activeDescriptionEn,
        String templateTaskId
) {
}
