package ch.marcovogt.epl.deviceregistryhealth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEvent;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DeviceTelemetryService {

    private static final int LOOKBACK_EVENTS = 200;
    private static final long EPOCH_SECONDS_MIN = 946_684_800L; // 2000-01-01
    private static final long EPOCH_SECONDS_MAX = 4_102_444_800L; // 2100-01-01
    private static final long EPOCH_MILLIS_MIN = 946_684_800_000L; // 2000-01-01
    private static final long EPOCH_MILLIS_MAX = 4_102_444_800_000L; // 2100-01-01

    private final CanonicalEventRepository canonicalEventRepository;
    private final DeviceStatusRepository deviceStatusRepository;
    private final ObjectMapper objectMapper;
    private final ConcurrentMap<String, TelemetrySnapshot> cache = new ConcurrentHashMap<>();

    public DeviceTelemetryService(
            CanonicalEventRepository canonicalEventRepository,
            DeviceStatusRepository deviceStatusRepository,
            ObjectMapper objectMapper
    ) {
        this.canonicalEventRepository = canonicalEventRepository;
        this.deviceStatusRepository = deviceStatusRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public StudentDeviceStateDto getStudentDeviceState(String deviceId) {
        String normalizedDeviceId = normalizePhysicalDeviceId(deviceId);
        if (normalizedDeviceId == null) {
            throw new IllegalArgumentException("deviceId must be a physical EPLD id");
        }

        DeviceStatus status = deviceStatusRepository.findById(normalizedDeviceId).orElse(null);
        TelemetrySnapshot snapshot = cache.computeIfAbsent(
                normalizedDeviceId,
                this::rebuildFromRecentEvents
        );

        Instant updatedAt = maxInstant(
                status == null ? null : status.getUpdatedAt(),
                snapshot.updatedAt()
        );

        return new StudentDeviceStateDto(
                normalizedDeviceId,
                status != null && status.isOnline(),
                status == null ? null : status.getLastSeen(),
                status == null ? null : status.getRssi(),
                snapshot.temperatureC(),
                snapshot.humidityPct(),
                snapshot.brightness(),
                snapshot.counterValue(),
                snapshot.buttonRedPressed(),
                snapshot.buttonBlackPressed(),
                snapshot.ledGreenOn(),
                snapshot.ledOrangeOn(),
                snapshot.uptimeMs(),
                snapshot.uptimeIngestTs(),
                updatedAt
        );
    }

    public void observeEvent(CanonicalEvent event) {
        if (event == null) {
            return;
        }
        String normalizedDeviceId = normalizePhysicalDeviceId(event.getDeviceId());
        if (normalizedDeviceId == null) {
            return;
        }

        TelemetryDelta delta = extractDelta(event);
        cache.compute(normalizedDeviceId, (ignored, previous) -> {
            TelemetrySnapshot baseline = previous == null
                    ? TelemetrySnapshot.empty(normalizedDeviceId)
                    : previous;
            return applyDelta(baseline, delta, event.getIngestTs(), true);
        });
    }

    private TelemetrySnapshot rebuildFromRecentEvents(String deviceId) {
        TelemetrySnapshot snapshot = TelemetrySnapshot.empty(deviceId);
        List<CanonicalEvent> recent = canonicalEventRepository.findRecent(
                deviceId,
                null,
                PageRequest.of(0, LOOKBACK_EVENTS)
        );

        for (CanonicalEvent event : recent) {
            TelemetryDelta delta = extractDelta(event);
            snapshot = applyDelta(snapshot, delta, event.getIngestTs(), false);
            if (snapshot.isComplete()) {
                break;
            }
        }
        return snapshot;
    }

    private TelemetrySnapshot applyDelta(
            TelemetrySnapshot snapshot,
            TelemetryDelta delta,
            Instant ingestTs,
            boolean overwrite
    ) {
        boolean hasAnyValue = delta.hasAnyValue();
        Double temperatureC = mergeNumber(snapshot.temperatureC(), delta.temperatureC(), overwrite);
        Double humidityPct = mergeNumber(snapshot.humidityPct(), delta.humidityPct(), overwrite);
        Double brightness = mergeNumber(snapshot.brightness(), delta.brightness(), overwrite);
        Double counterValue = mergeNumber(snapshot.counterValue(), delta.counterValue(), overwrite);
        Boolean buttonRedPressed = mergeBoolean(snapshot.buttonRedPressed(), delta.buttonRedPressed(), overwrite);
        Boolean buttonBlackPressed = mergeBoolean(snapshot.buttonBlackPressed(), delta.buttonBlackPressed(), overwrite);
        Boolean ledGreenOn = mergeBoolean(snapshot.ledGreenOn(), delta.ledGreenOn(), overwrite);
        Boolean ledOrangeOn = mergeBoolean(snapshot.ledOrangeOn(), delta.ledOrangeOn(), overwrite);
        Long uptimeMs = mergeLong(snapshot.uptimeMs(), delta.uptimeMs(), overwrite);
        Instant uptimeIngestTs = uptimeMs == null
                ? null
                : (delta.uptimeMs() != null ? ingestTs : snapshot.uptimeIngestTs());
        Instant updatedAt = hasAnyValue
                ? maxInstant(snapshot.updatedAt(), ingestTs)
                : snapshot.updatedAt();

        return new TelemetrySnapshot(
                snapshot.deviceId(),
                temperatureC,
                humidityPct,
                brightness,
                counterValue,
                buttonRedPressed,
                buttonBlackPressed,
                ledGreenOn,
                ledOrangeOn,
                uptimeMs,
                uptimeIngestTs,
                updatedAt
        );
    }

    private TelemetryDelta extractDelta(CanonicalEvent event) {
        JsonNode payload = parsePayload(event.getPayloadJson());
        String eventType = safeLower(event.getEventType());
        String topic = safeLower(event.getTopic());
        boolean counterEvent = isCounterEvent(eventType, topic);

        Double temperature = firstNumber(payload,
                "/temperature",
                "/temp",
                "/tC",
                "/params/temperature:100/tC",
                "/params/temperature:100/value");
        if (temperature == null) {
            temperature = findNumberByKeys(payload, "temperature", "temp", "tC");
        }

        Double humidity = firstNumber(payload,
                "/humidity",
                "/hum",
                "/rh",
                "/params/humidity:100/rh",
                "/params/humidity:100/value");
        if (humidity == null) {
            humidity = findNumberByKeys(payload, "humidity", "hum", "rh");
        }

        Double brightness = firstNumber(payload,
                "/brightness",
                "/lux",
                "/ldr",
                "/voltage",
                "/params/voltmeter:100/voltage",
                "/params/voltmeter:100/value");
        if (brightness == null) {
            brightness = findNumberByKeys(payload, "brightness", "lux", "ldr", "voltage");
        }

        Double counterValue = extractCounterValue(payload, counterEvent);
        Boolean buttonRedPressed = extractButtonState(payload, eventType, "red");
        Boolean buttonBlackPressed = extractButtonState(payload, eventType, "black");
        Boolean ledGreenOn = extractLedState(payload, eventType, topic, "green");
        Boolean ledOrangeOn = extractLedState(payload, eventType, topic, "orange");
        Long uptimeMs = extractUptimeMs(payload);

        return new TelemetryDelta(
                temperature,
                humidity,
                brightness,
                counterValue,
                buttonRedPressed,
                buttonBlackPressed,
                ledGreenOn,
                ledOrangeOn,
                uptimeMs
        );
    }

    private JsonNode parsePayload(String payloadJson) {
        if (payloadJson == null || payloadJson.isBlank()) {
            return MissingNode.getInstance();
        }
        String current = payloadJson.trim();
        for (int depth = 0; depth < 4; depth++) {
            try {
                JsonNode parsed = objectMapper.readTree(current);
                if (parsed != null && parsed.isTextual()) {
                    String next = parsed.asText("").trim();
                    if (next.isEmpty() || next.equals(current)) {
                        return parsed;
                    }
                    current = next;
                    continue;
                }
                return parsed == null ? MissingNode.getInstance() : parsed;
            } catch (Exception ex) {
                String unescaped = current
                        .replace("\\\"", "\"")
                        .replace("\\\\", "\\")
                        .replace("\\n", "\n")
                        .replace("\\r", "\r")
                        .replace("\\t", "\t")
                        .trim();
                if (unescaped.isEmpty() || unescaped.equals(current)) {
                    return MissingNode.getInstance();
                }
                current = unescaped;
            }
        }
        return MissingNode.getInstance();
    }

    private Double extractCounterValue(JsonNode payload, boolean allowLooseValue) {
        Double strict = firstNumber(payload,
                "/counter",
                "/count",
                "/total",
                "/counterValue",
                "/counter_value",
                "/blueCounter",
                "/params/counter:0/value",
                "/params/counter:100/value");
        if (strict == null) {
            strict = findNumberByKeys(payload,
                    "counter",
                    "count",
                    "total",
                    "counterValue",
                    "counter_value",
                    "blueCounter");
        }
        if (strict != null) {
            return isLikelyEpochTimestamp(strict) ? null : strict;
        }
        if (!allowLooseValue) {
            return null;
        }
        Double loose = firstNumber(payload, "/value");
        if (loose == null || isLikelyEpochTimestamp(loose)) {
            return null;
        }
        return loose;
    }

    private Boolean extractButtonState(JsonNode payload, String eventType, String color) {
        String prefix = "button." + color + ".";
        if (eventType.startsWith(prefix)) {
            if (eventType.endsWith(".press")) {
                return Boolean.TRUE;
            }
            if (eventType.endsWith(".release")) {
                return Boolean.FALSE;
            }
        }
        if ("red".equals(color)) {
            return firstBoolean(payload, "/params/input:0/state", "/input:0/state");
        }
        return firstBoolean(payload, "/params/input:1/state", "/input:1/state");
    }

    private Boolean extractLedState(JsonNode payload, String eventType, String topic, String color) {
        boolean targetEvent = "green".equals(color)
                ? eventType.contains("green") || topic.contains("switch:0")
                : eventType.contains("orange") || topic.contains("switch:1");
        if (!targetEvent) {
            return null;
        }
        if ("green".equals(color)) {
            return firstBoolean(
                    payload,
                    "/params/switch:0/output",
                    "/switch:0/output",
                    "/output",
                    "/on",
                    "/state",
                    "/value"
            );
        }
        return firstBoolean(
                payload,
                "/params/switch:1/output",
                "/switch:1/output",
                "/output",
                "/on",
                "/state",
                "/value"
        );
    }

    private Long extractUptimeMs(JsonNode payload) {
        Double directMs = firstNumber(payload, "/ts_uptime_ms", "/uptime_ms");
        if (directMs == null) {
            directMs = findNumberByKeys(payload, "ts_uptime_ms", "uptime_ms");
        }
        if (directMs != null && directMs >= 0) {
            return Math.round(directMs);
        }
        Double seconds = firstNumber(payload, "/sys/uptime", "/uptime");
        if (seconds != null && seconds >= 0) {
            return Math.round(seconds * 1000.0d);
        }
        return null;
    }

    private Double firstNumber(JsonNode node, String... pointers) {
        for (String pointer : pointers) {
            Double value = numberAt(node, pointer);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private Double numberAt(JsonNode node, String pointer) {
        if (node == null || node.isMissingNode() || pointer == null || pointer.isBlank()) {
            return null;
        }
        JsonNode value = node.at(pointer);
        if (value.isNumber()) {
            return value.asDouble();
        }
        if (value.isTextual()) {
            try {
                return Double.parseDouble(value.asText().trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private Boolean firstBoolean(JsonNode node, String... pointers) {
        for (String pointer : pointers) {
            Boolean value = booleanAt(node, pointer);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private Boolean booleanAt(JsonNode node, String pointer) {
        if (node == null || node.isMissingNode() || pointer == null || pointer.isBlank()) {
            return null;
        }
        JsonNode value = node.at(pointer);
        if (value.isBoolean()) {
            return value.asBoolean();
        }
        if (value.isNumber()) {
            if (value.asInt() == 1) {
                return Boolean.TRUE;
            }
            if (value.asInt() == 0) {
                return Boolean.FALSE;
            }
        }
        if (value.isTextual()) {
            String normalized = safeLower(value.asText());
            if ("true".equals(normalized)
                    || "on".equals(normalized)
                    || "pressed".equals(normalized)
                    || "press".equals(normalized)
                    || "1".equals(normalized)) {
                return Boolean.TRUE;
            }
            if ("false".equals(normalized)
                    || "off".equals(normalized)
                    || "released".equals(normalized)
                    || "release".equals(normalized)
                    || "0".equals(normalized)) {
                return Boolean.FALSE;
            }
        }
        return null;
    }

    private Double findNumberByKeys(JsonNode node, String... keys) {
        return findNumberByKeys(node, List.of(keys), 0);
    }

    private Double findNumberByKeys(JsonNode node, List<String> keys, int depth) {
        if (depth > 5 || node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        if (node.isArray()) {
            for (JsonNode entry : node) {
                Double value = findNumberByKeys(entry, keys, depth + 1);
                if (value != null) {
                    return value;
                }
            }
            return null;
        }
        if (!node.isObject()) {
            return null;
        }
        for (String key : keys) {
            JsonNode valueNode = node.get(key);
            if (valueNode == null || valueNode.isNull()) {
                continue;
            }
            if (valueNode.isNumber()) {
                return valueNode.asDouble();
            }
            if (valueNode.isTextual()) {
                try {
                    return Double.parseDouble(valueNode.asText().trim());
                } catch (NumberFormatException ignored) {
                    // Continue search.
                }
            }
        }
        var fields = node.fields();
        while (fields.hasNext()) {
            var entry = fields.next();
            Double value = findNumberByKeys(entry.getValue(), keys, depth + 1);
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private String safeLower(String value) {
        return value == null ? "" : value.trim().toLowerCase();
    }

    private boolean isCounterEvent(String eventType, String topic) {
        return eventType.contains("counter") || topic.contains("/counter");
    }

    private boolean isLikelyEpochTimestamp(Double value) {
        if (value == null || !Double.isFinite(value)) {
            return false;
        }
        long rounded = Math.round(value);
        if (rounded >= EPOCH_MILLIS_MIN && rounded <= EPOCH_MILLIS_MAX) {
            return true;
        }
        return rounded >= EPOCH_SECONDS_MIN && rounded <= EPOCH_SECONDS_MAX;
    }

    private String normalizePhysicalDeviceId(String rawDeviceId) {
        if (rawDeviceId == null) {
            return null;
        }
        String normalized = rawDeviceId.trim().toLowerCase();
        if (normalized.isBlank()) {
            return null;
        }
        if (!DeviceIdMapping.isPhysicalDeviceId(normalized)) {
            return null;
        }
        return normalized;
    }

    private Instant maxInstant(Instant left, Instant right) {
        if (left == null) {
            return right;
        }
        if (right == null) {
            return left;
        }
        return left.isAfter(right) ? left : right;
    }

    private Double mergeNumber(Double previous, Double incoming, boolean overwrite) {
        if (incoming == null) {
            return previous;
        }
        if (overwrite || previous == null) {
            return incoming;
        }
        return previous;
    }

    private Long mergeLong(Long previous, Long incoming, boolean overwrite) {
        if (incoming == null) {
            return previous;
        }
        if (overwrite || previous == null) {
            return incoming;
        }
        return previous;
    }

    private Boolean mergeBoolean(Boolean previous, Boolean incoming, boolean overwrite) {
        if (incoming == null) {
            return previous;
        }
        if (overwrite || previous == null) {
            return incoming;
        }
        return previous;
    }

    private record TelemetryDelta(
            Double temperatureC,
            Double humidityPct,
            Double brightness,
            Double counterValue,
            Boolean buttonRedPressed,
            Boolean buttonBlackPressed,
            Boolean ledGreenOn,
            Boolean ledOrangeOn,
            Long uptimeMs
    ) {
        boolean hasAnyValue() {
            return temperatureC != null
                    || humidityPct != null
                    || brightness != null
                    || counterValue != null
                    || buttonRedPressed != null
                    || buttonBlackPressed != null
                    || ledGreenOn != null
                    || ledOrangeOn != null
                    || uptimeMs != null;
        }
    }

    private record TelemetrySnapshot(
            String deviceId,
            Double temperatureC,
            Double humidityPct,
            Double brightness,
            Double counterValue,
            Boolean buttonRedPressed,
            Boolean buttonBlackPressed,
            Boolean ledGreenOn,
            Boolean ledOrangeOn,
            Long uptimeMs,
            Instant uptimeIngestTs,
            Instant updatedAt
    ) {
        static TelemetrySnapshot empty(String deviceId) {
            return new TelemetrySnapshot(
                    deviceId,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
            );
        }

        boolean isComplete() {
            return temperatureC != null
                    && humidityPct != null
                    && brightness != null
                    && counterValue != null
                    && buttonRedPressed != null
                    && buttonBlackPressed != null
                    && ledGreenOn != null
                    && ledOrangeOn != null
                    && uptimeMs != null;
        }
    }
}
