package ch.marcovogt.epl.groupcollaborationsync;

import ch.marcovogt.epl.admin.DeviceCommandType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record StudentCommandRequest(
        @NotBlank String deviceId,
        @NotNull DeviceCommandType command,
        Boolean on
) {
}
