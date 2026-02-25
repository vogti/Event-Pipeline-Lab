package ch.marcovogt.epl.authsession;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
        @NotBlank String username,
        @NotBlank String pin
) {
}
