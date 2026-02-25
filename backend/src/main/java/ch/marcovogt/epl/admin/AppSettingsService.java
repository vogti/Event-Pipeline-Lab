package ch.marcovogt.epl.admin;

import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AppSettingsService {

    private static final short SETTINGS_ROW_ID = 1;

    private final AppSettingsRepository appSettingsRepository;
    private final Clock clock;

    public AppSettingsService(AppSettingsRepository appSettingsRepository) {
        this.appSettingsRepository = appSettingsRepository;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public AppSettings getOrCreate() {
        return appSettingsRepository.findById(SETTINGS_ROW_ID)
                .orElseGet(() -> {
                    AppSettings settings = new AppSettings();
                    settings.setId(SETTINGS_ROW_ID);
                    settings.setDefaultLanguageMode(LanguageMode.BROWSER_EN_FALLBACK);
                    settings.setTimeFormat24h(true);
                    settings.setUpdatedAt(Instant.now(clock));
                    settings.setUpdatedBy("system");
                    return appSettingsRepository.save(settings);
                });
    }

    @Transactional
    public AppSettings update(LanguageMode mode, Boolean timeFormat24h, String actor) {
        AppSettings settings = getOrCreate();
        settings.setDefaultLanguageMode(mode);
        if (timeFormat24h != null) {
            settings.setTimeFormat24h(timeFormat24h);
        }
        settings.setUpdatedAt(Instant.now(clock));
        settings.setUpdatedBy(actor);
        return appSettingsRepository.save(settings);
    }
}
