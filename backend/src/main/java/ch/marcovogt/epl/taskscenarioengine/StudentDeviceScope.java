package ch.marcovogt.epl.taskscenarioengine;

import java.util.Locale;

public enum StudentDeviceScope {
    OWN_DEVICE,
    ADMIN_DEVICE,
    ALL_DEVICES;

    public static StudentDeviceScope parseOrDefault(String raw, StudentDeviceScope fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String normalized = raw.trim().toUpperCase(Locale.ROOT);
        for (StudentDeviceScope scope : values()) {
            if (scope.name().equals(normalized)) {
                return scope;
            }
        }
        return fallback;
    }
}
