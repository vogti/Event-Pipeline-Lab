package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotBlank;

public record UpdateTaskDetailsRequest(
        @NotBlank String taskId,
        @NotBlank String titleDe,
        @NotBlank String titleEn,
        @NotBlank String descriptionDe,
        @NotBlank String descriptionEn
) {
}
