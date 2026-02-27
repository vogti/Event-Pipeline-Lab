package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.common.EventCategory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.Iterator;
import java.util.Locale;
import java.util.regex.Pattern;

final class EventValueExtractor {

    private static final Pattern NUMBER_LITERAL = Pattern.compile("^-?\\d+(\\.\\d+)?([eE][+-]?\\d+)?$");
    private static final String[] PRIORITY_VALUE_KEYS = {
            "value", "state", "output", "on", "action", "event", "button", "online"
    };

    private EventValueExtractor() {
    }

    static String extractValue(
            EventCategory category,
            String eventType,
            String topic,
            JsonNode payloadNode,
            ObjectMapper objectMapper
    ) {
        String lowerEventType = eventType == null ? "" : eventType.toLowerCase(Locale.ROOT);
        String lowerTopic = topic == null ? "" : topic.toLowerCase(Locale.ROOT);

        if (isTelemetryEvent(lowerTopic, lowerEventType)) {
            return "";
        }
        if ("status.system".equals(lowerEventType) || lowerEventType.startsWith("status.system.")) {
            return "";
        }
        if (lowerEventType.endsWith(".press")) {
            return "pressed";
        }
        if (lowerEventType.endsWith(".release")) {
            return "released";
        }

        JsonNode payload = normalizePayloadForExtraction(payloadNode, objectMapper, 0);
        if (payload == null || payload.isNull()) {
            return "";
        }

        if ("status.mqtt".equals(lowerEventType) || lowerEventType.startsWith("status.mqtt.")) {
            Boolean mqttConnected = firstBoolean(
                    payload,
                    path("params", "mqtt", "connected"),
                    path("mqtt", "connected"),
                    path("connected")
            );
            if (mqttConnected != null) {
                return String.valueOf(mqttConnected);
            }
        }

        Double temperature = firstNumber(
                payload,
                path("temperature"),
                path("temp"),
                path("tC"),
                path("params", "temperature:100", "tC"),
                path("params", "temperature:100", "value")
        );
        if (temperature == null) {
            temperature = findNumberByKeys(payload, new String[]{"temperature", "temp", "tC"}, 0);
        }

        Double humidity = firstNumber(
                payload,
                path("humidity"),
                path("hum"),
                path("rh"),
                path("params", "humidity:100", "rh"),
                path("params", "humidity:100", "value")
        );
        if (humidity == null) {
            humidity = findNumberByKeys(payload, new String[]{"humidity", "hum", "rh"}, 0);
        }

        Double brightness = firstNumber(
                payload,
                path("brightness"),
                path("lux"),
                path("ldr"),
                path("voltage"),
                path("params", "voltmeter:100", "voltage"),
                path("params", "voltmeter:100", "value")
        );
        if (brightness == null) {
            brightness = findNumberByKeys(payload, new String[]{"brightness", "lux", "ldr", "voltage"}, 0);
        }

        Double counter = extractCounterValue(payload, true);

        if (lowerEventType.contains("temperature") && temperature != null) {
            return String.format(Locale.ROOT, "%.1f \u00b0C", temperature);
        }
        if (lowerEventType.contains("humidity") && humidity != null) {
            return String.format(Locale.ROOT, "%d %%", Math.round(humidity));
        }
        if ((lowerEventType.contains("ldr") || lowerTopic.contains("/sensor/ldr")) && brightness != null) {
            return formatBrightnessMeasurement(brightness);
        }
        if (category == EventCategory.COUNTER && counter != null) {
            if (isWholeNumber(counter)) {
                return Long.toString(Math.round(counter));
            }
            return String.format(Locale.ROOT, "%.2f", counter);
        }

        if (category == EventCategory.SENSOR) {
            StringBuilder summary = new StringBuilder();
            if (temperature != null) {
                summary.append(String.format(Locale.ROOT, "%.1f \u00b0C", temperature));
            }
            if (humidity != null) {
                if (!summary.isEmpty()) {
                    summary.append(" / ");
                }
                summary.append(String.format(Locale.ROOT, "%d %%", Math.round(humidity)));
            }
            if (brightness != null && summary.isEmpty()) {
                summary.append(formatBrightnessMeasurement(brightness));
            }
            if (!summary.isEmpty()) {
                return summary.toString();
            }
        }

        if (lowerEventType.contains("led.green.state_changed")
                || lowerEventType.contains("led.orange.state_changed")) {
            Boolean ledState = firstBoolean(
                    payload,
                    path("output"),
                    path("state"),
                    path("on"),
                    path("value"),
                    path("params", "switch:0", "output"),
                    path("switch:0", "output"),
                    path("params", "switch:1", "output"),
                    path("switch:1", "output")
            );
            if (ledState != null) {
                return ledState ? "on" : "off";
            }
        }

        Boolean state = firstBoolean(
                payload,
                path("state"),
                path("output"),
                path("on"),
                path("online"),
                path("value")
        );
        if (state != null) {
            if (lowerEventType.contains("button")) {
                return state ? "pressed" : "released";
            }
            if (lowerEventType.contains("online") || lowerTopic.contains("/status/heartbeat")) {
                return state ? "online" : "offline";
            }
            return state ? "on" : "off";
        }

        Double rssi = firstNumber(
                payload,
                path("rssi"),
                path("wifi", "rssi"),
                path("params", "wifi", "rssi")
        );
        if (rssi == null) {
            rssi = findNumberByKeys(payload, new String[]{"rssi"}, 0);
        }
        if (rssi != null) {
            return String.format(Locale.ROOT, "%d dBm", Math.round(rssi));
        }

        String fallback = extractEventValueFromPayload(payload, 0);
        return fallback == null ? "" : fallback;
    }

    private static JsonNode normalizePayloadForExtraction(JsonNode payloadNode, ObjectMapper objectMapper, int depth) {
        if (payloadNode == null || payloadNode.isNull() || depth > 4) {
            return payloadNode;
        }
        if (payloadNode.isTextual()) {
            JsonNode parsed = parseJsonLikeText(payloadNode.asText(), objectMapper);
            return parsed == null ? payloadNode : normalizePayloadForExtraction(parsed, objectMapper, depth + 1);
        }
        if (payloadNode.isObject() && payloadNode.size() == 1 && payloadNode.has("raw")) {
            return normalizePayloadForExtraction(payloadNode.get("raw"), objectMapper, depth + 1);
        }
        if (payloadNode.isObject() && payloadNode.size() == 1 && payloadNode.has("value")) {
            JsonNode rawValue = payloadNode.get("value");
            if (rawValue != null && rawValue.isTextual() && looksLikeJsonLiteral(rawValue.asText().trim())) {
                JsonNode parsed = parseJsonLikeText(rawValue.asText(), objectMapper);
                if (parsed != null) {
                    return normalizePayloadForExtraction(parsed, objectMapper, depth + 1);
                }
            }
        }
        return payloadNode;
    }

    private static JsonNode parseJsonLikeText(String rawValue, ObjectMapper objectMapper) {
        String current = rawValue == null ? "" : rawValue.trim();
        if (current.isEmpty()) {
            return TextNode.valueOf("");
        }

        for (int depth = 0; depth < 4; depth++) {
            try {
                JsonNode parsed = objectMapper.readTree(current);
                if (parsed != null && parsed.isTextual()) {
                    String next = parsed.asText().trim();
                    if (next.isEmpty()) {
                        return TextNode.valueOf("");
                    }
                    if (!looksLikeJsonLiteral(next) || next.equals(current)) {
                        return parsed;
                    }
                    current = next;
                    continue;
                }
                return parsed;
            } catch (Exception ignored) {
                String unescaped = current
                        .replace("\\\"", "\"")
                        .replace("\\\\", "\\")
                        .replace("\\n", "\n")
                        .replace("\\r", "\r")
                        .replace("\\t", "\t")
                        .trim();
                if (unescaped.isEmpty() || unescaped.equals(current)) {
                    return null;
                }
                current = unescaped;
            }
        }
        return null;
    }

    private static boolean isTelemetryEvent(String lowerTopic, String lowerEventType) {
        return lowerTopic.contains("/telemetry") || lowerEventType.contains("telemetry");
    }

    private static boolean looksLikeJsonLiteral(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        if (value.startsWith("{") || value.startsWith("[") || value.startsWith("\"")) {
            return true;
        }
        if ("true".equals(value) || "false".equals(value) || "null".equals(value)) {
            return true;
        }
        return NUMBER_LITERAL.matcher(value).matches();
    }

    private static String formatBrightnessMeasurement(double value) {
        if (value > 5) {
            return String.format(Locale.ROOT, "%d lx", Math.round(value));
        }
        return String.format(Locale.ROOT, "%.2f V", value);
    }

    private static boolean isWholeNumber(double value) {
        return Math.rint(value) == value;
    }

    private static Double extractCounterValue(JsonNode payload, boolean allowLooseValue) {
        Double strictCounter = firstNumber(
                payload,
                path("counter"),
                path("count"),
                path("total"),
                path("counterValue"),
                path("counter_value"),
                path("blueCounter"),
                path("params", "counter:0", "value"),
                path("params", "counter:100", "value")
        );
        if (strictCounter == null) {
            strictCounter = findNumberByKeys(
                    payload,
                    new String[]{"counter", "count", "total", "counterValue", "counter_value", "blueCounter"},
                    0
            );
        }
        if (strictCounter != null) {
            return isLikelyEpochTimestamp(strictCounter) ? null : strictCounter;
        }

        if (!allowLooseValue) {
            return null;
        }
        Double looseValue = firstNumber(payload, path("value"));
        if (looseValue == null) {
            return null;
        }
        return isLikelyEpochTimestamp(looseValue) ? null : looseValue;
    }

    private static boolean isLikelyEpochTimestamp(double value) {
        if (!Double.isFinite(value)) {
            return false;
        }
        if (value >= 946_684_800_000d && value <= 4_102_444_800_000d) {
            return true;
        }
        return value >= 946_684_800d && value <= 4_102_444_800d;
    }

    private static String extractEventValueFromPayload(JsonNode node, int depth) {
        if (depth > 4 || node == null || node.isNull()) {
            return null;
        }

        String scalar = formatScalar(node);
        if (scalar != null) {
            return scalar;
        }

        if (node.isArray()) {
            for (JsonNode entry : node) {
                String value = extractEventValueFromPayload(entry, depth + 1);
                if (value != null) {
                    return value;
                }
            }
            return null;
        }

        if (!node.isObject()) {
            return null;
        }

        for (String key : PRIORITY_VALUE_KEYS) {
            JsonNode value = node.get(key);
            if (value == null) {
                continue;
            }
            String extracted = extractEventValueFromPayload(value, depth + 1);
            if (extracted != null) {
                return extracted;
            }
        }

        Iterator<JsonNode> iterator = node.elements();
        while (iterator.hasNext()) {
            String extracted = extractEventValueFromPayload(iterator.next(), depth + 1);
            if (extracted != null) {
                return extracted;
            }
        }
        return null;
    }

    private static String formatScalar(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isTextual()) {
            return node.asText();
        }
        if (node.isNumber() || node.isBoolean()) {
            return node.asText();
        }
        return null;
    }

    private static Double firstNumber(JsonNode root, String[]... paths) {
        for (String[] path : paths) {
            Double value = toNumber(readPath(root, path));
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private static Boolean firstBoolean(JsonNode root, String[]... paths) {
        for (String[] path : paths) {
            Boolean value = toBoolean(readPath(root, path));
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private static JsonNode readPath(JsonNode root, String... path) {
        JsonNode current = root;
        for (String segment : path) {
            if (current == null || !current.isObject()) {
                return null;
            }
            current = current.get(segment);
            if (current == null) {
                return null;
            }
        }
        return current;
    }

    private static Double toNumber(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isNumber()) {
            double value = node.asDouble();
            return Double.isFinite(value) ? value : null;
        }
        if (node.isTextual()) {
            String text = node.asText().trim();
            if (text.isEmpty()) {
                return null;
            }
            try {
                double parsed = Double.parseDouble(text);
                return Double.isFinite(parsed) ? parsed : null;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static Boolean toBoolean(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (node.isBoolean()) {
            return node.asBoolean();
        }
        if (node.isNumber()) {
            if (node.asInt() == 1) {
                return true;
            }
            if (node.asInt() == 0) {
                return false;
            }
            return null;
        }
        if (node.isTextual()) {
            String normalized = node.asText().trim().toLowerCase(Locale.ROOT);
            if ("true".equals(normalized)
                    || "on".equals(normalized)
                    || "pressed".equals(normalized)
                    || "press".equals(normalized)
                    || "1".equals(normalized)) {
                return true;
            }
            if ("false".equals(normalized)
                    || "off".equals(normalized)
                    || "released".equals(normalized)
                    || "release".equals(normalized)
                    || "0".equals(normalized)) {
                return false;
            }
        }
        return null;
    }

    private static Double findNumberByKeys(JsonNode node, String[] keys, int depth) {
        if (node == null || node.isNull() || depth > 5) {
            return null;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                Double found = findNumberByKeys(item, keys, depth + 1);
                if (found != null) {
                    return found;
                }
            }
            return null;
        }
        if (!node.isObject()) {
            return null;
        }

        for (String key : keys) {
            JsonNode direct = node.get(key);
            Double directNumber = toNumber(direct);
            if (directNumber != null) {
                return directNumber;
            }
        }

        Iterator<JsonNode> iterator = node.elements();
        while (iterator.hasNext()) {
            Double found = findNumberByKeys(iterator.next(), keys, depth + 1);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    private static String[] path(String... segments) {
        return segments;
    }
}
