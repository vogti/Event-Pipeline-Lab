package ch.marcovogt.epl.externalsources;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateExternalStreamSourceConfigRequest(
        @NotBlank
        @Size(max = 1024)
        String endpointUrl
) {
}
