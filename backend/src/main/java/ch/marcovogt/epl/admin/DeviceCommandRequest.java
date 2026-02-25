package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotNull;

public record DeviceCommandRequest(
        @NotNull DeviceCommandType command,
        Boolean on
) {
}
