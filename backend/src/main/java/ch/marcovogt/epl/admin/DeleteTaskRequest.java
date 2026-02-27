package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotBlank;

public record DeleteTaskRequest(
        @NotBlank String taskId
) {
}
