package ch.marcovogt.epl.admin;

import java.util.Arrays;
import java.util.Optional;

public enum SystemDataPart {
    APP_SETTINGS,
    TASK_STATE,
    TASK_DEFINITION_STATE,
    TASK_PIPELINE_CONFIG_STATE,
    FEED_SCENARIO_STATE,
    GROUP_STATE,
    PIPELINE_STATE,
    AUTH_ACCOUNTS,
    DEVICE_STATUS,
    VIRTUAL_DEVICE_STATE,
    EXTERNAL_STREAM_SOURCE_STATE,
    AUDIT_ENTRIES,
    EVENT_DATA;

    public static Optional<SystemDataPart> fromKey(String key) {
        if (key == null || key.isBlank()) {
            return Optional.empty();
        }
        return Arrays.stream(values())
                .filter(part -> part.name().equalsIgnoreCase(key.trim()))
                .findFirst();
    }
}
