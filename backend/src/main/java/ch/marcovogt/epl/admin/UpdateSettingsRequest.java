package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record UpdateSettingsRequest(
        @NotNull LanguageMode defaultLanguageMode,
        Boolean timeFormat24h,
        Boolean studentVirtualDeviceVisible,
        @Size(max = 64) String adminDeviceId,
        VirtualDeviceTopicMode virtualDeviceTopicMode
) {
}
