package ch.marcovogt.epl.admin;

import java.time.Instant;

public record AppSettingsDto(
        LanguageMode defaultLanguageMode,
        Instant updatedAt,
        String updatedBy
) {
    public static AppSettingsDto from(AppSettings settings) {
        return new AppSettingsDto(
                settings.getDefaultLanguageMode(),
                settings.getUpdatedAt(),
                settings.getUpdatedBy()
        );
    }
}
