package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateDevicePinRequest(
        @NotBlank @Size(max = 64) String pin
) {
}
