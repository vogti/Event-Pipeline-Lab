package ch.marcovogt.epl.admin;

import java.time.Instant;

public record AppSettingsDto(
        LanguageMode defaultLanguageMode,
        boolean timeFormat24h,
        Instant updatedAt,
        String updatedBy
) {
    public static AppSettingsDto from(AppSettings settings) {
        return new AppSettingsDto(
                settings.getDefaultLanguageMode(),
                settings.isTimeFormat24h(),
                settings.getUpdatedAt(),
                settings.getUpdatedBy()
        );
    }
}
