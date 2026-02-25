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
    private volatile Boolean studentVirtualVisibleCache;

    public AppSettingsService(AppSettingsRepository appSettingsRepository) {
        this.appSettingsRepository = appSettingsRepository;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public AppSettings getOrCreate() {
        AppSettings settings = appSettingsRepository.findById(SETTINGS_ROW_ID)
                .orElseGet(() -> {
                    AppSettings created = new AppSettings();
                    created.setId(SETTINGS_ROW_ID);
                    created.setDefaultLanguageMode(LanguageMode.BROWSER_EN_FALLBACK);
                    created.setTimeFormat24h(true);
                    created.setStudentVirtualDeviceVisible(true);
                    created.setUpdatedAt(Instant.now(clock));
                    created.setUpdatedBy("system");
                    return appSettingsRepository.save(created);
                });
        studentVirtualVisibleCache = settings.isStudentVirtualDeviceVisible();
        return settings;
    }

    @Transactional
    public AppSettings update(
            LanguageMode mode,
            Boolean timeFormat24h,
            Boolean studentVirtualDeviceVisible,
            String actor
    ) {
        AppSettings settings = getOrCreate();
        settings.setDefaultLanguageMode(mode);
        if (timeFormat24h != null) {
            settings.setTimeFormat24h(timeFormat24h);
        }
        if (studentVirtualDeviceVisible != null) {
            settings.setStudentVirtualDeviceVisible(studentVirtualDeviceVisible);
        }
        settings.setUpdatedAt(Instant.now(clock));
        settings.setUpdatedBy(actor);
        AppSettings saved = appSettingsRepository.save(settings);
        studentVirtualVisibleCache = saved.isStudentVirtualDeviceVisible();
        return saved;
    }

    public boolean isStudentVirtualDeviceVisible() {
        Boolean cached = studentVirtualVisibleCache;
        if (cached != null) {
            return cached;
        }
        return getOrCreate().isStudentVirtualDeviceVisible();
    }
}
