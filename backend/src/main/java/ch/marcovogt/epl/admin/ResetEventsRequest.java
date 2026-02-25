package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotNull;

public record ResetEventsRequest(
        @NotNull Boolean confirm
) {
}
