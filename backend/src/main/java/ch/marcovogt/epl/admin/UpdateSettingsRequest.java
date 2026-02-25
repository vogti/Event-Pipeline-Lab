package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotNull;

public record UpdateSettingsRequest(
        @NotNull LanguageMode defaultLanguageMode,
        Boolean timeFormat24h
) {
}
