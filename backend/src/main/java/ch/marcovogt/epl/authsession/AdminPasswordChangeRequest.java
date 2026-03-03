package ch.marcovogt.epl.authsession;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AdminPasswordChangeRequest(
        @NotBlank @Size(max = 64) String currentPassword,
        @NotBlank @Size(max = 64) String newPassword
) {
}
