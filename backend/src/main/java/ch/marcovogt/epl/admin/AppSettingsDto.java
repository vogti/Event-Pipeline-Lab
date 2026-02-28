package ch.marcovogt.epl.admin;

import java.time.Instant;

public record AppSettingsDto(
        LanguageMode defaultLanguageMode,
        boolean timeFormat24h,
        boolean studentVirtualDeviceVisible,
        String adminDeviceId,
        VirtualDeviceTopicMode virtualDeviceTopicMode,
        Instant updatedAt,
        String updatedBy
) {
    public static AppSettingsDto from(AppSettings settings) {
        return new AppSettingsDto(
                settings.getDefaultLanguageMode(),
                settings.isTimeFormat24h(),
                settings.isStudentVirtualDeviceVisible(),
                settings.getAdminDeviceId(),
                settings.getVirtualDeviceTopicMode(),
                settings.getUpdatedAt(),
                settings.getUpdatedBy()
        );
    }
}
