package ch.marcovogt.epl.groupcollaborationsync;

import jakarta.validation.constraints.NotNull;
import java.util.Map;

public record StudentConfigUpdateRequest(
        @NotNull Map<String, Object> config
) {
}
