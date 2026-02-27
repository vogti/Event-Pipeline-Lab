package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;
import java.util.Locale;

public final class PipelineSinkLibrary {

    public static final String EVENT_FEED = "EVENT_FEED";
    public static final String SEND_EVENT = "SEND_EVENT";
    public static final String VIRTUAL_SIGNAL = "VIRTUAL_SIGNAL";

    public static final String EVENT_FEED_ID = "event-feed";
    public static final String SEND_EVENT_ID = "send-event";
    public static final String VIRTUAL_SIGNAL_ID = "virtual-signal";

    private PipelineSinkLibrary() {
    }

    public static List<String> knownTypes() {
        return List.of(EVENT_FEED, SEND_EVENT, VIRTUAL_SIGNAL);
    }

    public static boolean isKnown(String rawType) {
        return knownTypes().contains(normalizeType(rawType));
    }

    public static String normalizeType(String rawType) {
        if (rawType == null || rawType.isBlank()) {
            return EVENT_FEED;
        }
        String normalized = rawType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case EVENT_FEED -> EVENT_FEED;
            case SEND_EVENT, "DEVICE_CONTROL" -> SEND_EVENT;
            case VIRTUAL_SIGNAL -> VIRTUAL_SIGNAL;
            default -> EVENT_FEED;
        };
    }

    public static String defaultIdForType(String type) {
        String normalized = normalizeType(type);
        return switch (normalized) {
            case SEND_EVENT -> SEND_EVENT_ID;
            case VIRTUAL_SIGNAL -> VIRTUAL_SIGNAL_ID;
            default -> EVENT_FEED_ID;
        };
    }
}
