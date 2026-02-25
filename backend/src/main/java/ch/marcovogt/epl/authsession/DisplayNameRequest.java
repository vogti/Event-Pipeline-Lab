package ch.marcovogt.epl.authsession;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DisplayNameRequest(
        @NotBlank @Size(max = 48) String displayName
) {
}
