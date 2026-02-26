package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.common.DeviceIdMapping;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

@Service
public class AppSettingsService {

    private static final short SETTINGS_ROW_ID = 1;

    private final AppSettingsRepository appSettingsRepository;
    private final Clock clock;
    private volatile Boolean studentVirtualVisibleCache;
    private volatile String adminDeviceIdCache;

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
                    created.setAdminDeviceId(null);
                    created.setUpdatedAt(Instant.now(clock));
                    created.setUpdatedBy("system");
                    return appSettingsRepository.save(created);
                });
        studentVirtualVisibleCache = settings.isStudentVirtualDeviceVisible();
        adminDeviceIdCache = settings.getAdminDeviceId();
        return settings;
    }

    @Transactional
    public AppSettings update(
            LanguageMode mode,
            Boolean timeFormat24h,
            Boolean studentVirtualDeviceVisible,
            String adminDeviceId,
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
        settings.setAdminDeviceId(normalizeAdminDeviceId(adminDeviceId));
        settings.setUpdatedAt(Instant.now(clock));
        settings.setUpdatedBy(actor);
        AppSettings saved = appSettingsRepository.save(settings);
        studentVirtualVisibleCache = saved.isStudentVirtualDeviceVisible();
        adminDeviceIdCache = saved.getAdminDeviceId();
        return saved;
    }

    public boolean isStudentVirtualDeviceVisible() {
        Boolean cached = studentVirtualVisibleCache;
        if (cached != null) {
            return cached;
        }
        return getOrCreate().isStudentVirtualDeviceVisible();
    }

    public String getAdminDeviceId() {
        String cached = adminDeviceIdCache;
        if (cached != null) {
            return cached;
        }
        return getOrCreate().getAdminDeviceId();
    }

    public boolean isAdminDevice(String deviceId) {
        if (deviceId == null || deviceId.isBlank()) {
            return false;
        }
        String configured = getAdminDeviceId();
        if (configured == null || configured.isBlank()) {
            return false;
        }
        return configured.equalsIgnoreCase(deviceId.trim());
    }

    private String normalizeAdminDeviceId(String rawAdminDeviceId) {
        if (rawAdminDeviceId == null) {
            return null;
        }
        String normalized = rawAdminDeviceId.trim().toLowerCase(Locale.ROOT);
        if (normalized.isBlank()) {
            return null;
        }
        if (!DeviceIdMapping.isPhysicalDeviceId(normalized)) {
            throw new ResponseStatusException(BAD_REQUEST, "adminDeviceId must reference a physical EPLD id");
        }
        return normalized;
    }
}
