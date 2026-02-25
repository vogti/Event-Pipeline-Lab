package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotBlank;

public record ActivateTaskRequest(
        @NotBlank String taskId
) {
}
