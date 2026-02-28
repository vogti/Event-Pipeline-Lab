package ch.marcovogt.epl.eventingestionnormalization;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.common.EventCategory;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class CanonicalEventNormalizer {

    private static final String EMPTY_JSON = "{}";

    private final ObjectMapper objectMapper;

    public CanonicalEventNormalizer(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public NormalizedEvent normalize(String topic, byte[] payloadBytes, Instant ingestTs) {
        List<String> errors = new ArrayList<>();
        boolean valid = true;

        JsonNode payloadNode;
        try {
            payloadNode = objectMapper.readTree(payloadBytes);
        } catch (Exception ex) {
            valid = false;
            errors.add("payload-not-json: " + ex.getMessage());
            ObjectNode rawNode = objectMapper.createObjectNode();
            rawNode.put("raw", new String(payloadBytes, StandardCharsets.UTF_8));
            payloadNode = rawNode;
        }

        String deviceId = extractDeviceId(topic, payloadNode);
        if (deviceId == null || deviceId.isBlank()) {
            valid = false;
            errors.add("device-id-missing");
            deviceId = "unknown";
        }

        String eventType = determineEventType(topic, payloadNode);
        String canonicalTopic = canonicalizeTopic(topic, deviceId, eventType);
        EventCategory category = categorize(canonicalTopic, eventType);
        boolean isInternal = isInternal(canonicalTopic, category, eventType);

        Instant deviceTs = extractDeviceTimestamp(payloadNode);
        Long sequenceNo = extractSequenceNo(payloadNode);

        CanonicalEvent event = new CanonicalEvent();
        event.setId(UUID.randomUUID());
        event.setDeviceId(deviceId);
        event.setSource(deviceId);
        event.setTopic(canonicalTopic);
        event.setEventType(eventType);
        event.setCategory(category);
        event.setPayloadJson(toJson(payloadNode));
        event.setDeviceTs(deviceTs);
        event.setIngestTs(ingestTs);
        event.setValid(valid);
        event.setValidationErrors(errors.isEmpty() ? null : String.join(";", errors));
        event.setInternal(isInternal);
        event.setScenarioFlags(EMPTY_JSON);
        event.setGroupKey(extractGroupKey(deviceId, payloadNode));
        event.setSequenceNo(sequenceNo);

        return new NormalizedEvent(event, payloadNode, extractExplicitOnline(topic, payloadNode));
    }

    private String extractDeviceId(String topic, JsonNode payloadNode) {
        String payloadDeviceId = normalizeDeviceId(text(payloadNode, "deviceId"));
        String[] segments = topic.split("/");
        String topicDeviceId = null;
        if (segments.length >= 2 && "epld".equals(segments[0])) {
            topicDeviceId = normalizeDeviceId(segments[1]);
        } else if (segments.length >= 1
                && (segments[0].startsWith("epld") || segments[0].startsWith("eplvd"))) {
            topicDeviceId = normalizeDeviceId(segments[0]);
        }

        // In physical-topic mirror mode, keep source ownership on the virtual device payload id.
        if (payloadDeviceId != null
                && topicDeviceId != null
                && topic.endsWith("/events/rpc")
                && DeviceIdMapping.isVirtualDeviceId(payloadDeviceId)
                && DeviceIdMapping.isPhysicalDeviceId(topicDeviceId)) {
            return payloadDeviceId;
        }

        if (topicDeviceId != null) {
            return topicDeviceId;
        }

        if (payloadDeviceId != null) {
            return payloadDeviceId;
        }

        String payloadDeviceName = normalizeDeviceId(text(payloadNode.at("/device/name")));
        if (payloadDeviceName != null) {
            return payloadDeviceName;
        }

        return null;
    }

    private String normalizeDeviceId(String rawDeviceId) {
        if (rawDeviceId == null) {
            return null;
        }
        String normalized = rawDeviceId.trim();
        if (normalized.isBlank()) {
            return null;
        }
        if (!(normalized.startsWith("epld") || normalized.startsWith("eplvd"))) {
            return null;
        }
        return normalized;
    }

    private String determineEventType(String topic, JsonNode payloadNode) {
        if (topic.endsWith("/online")) {
            return "device.online.changed";
        }
        if (topic.endsWith("/telemetry")) {
            return "telemetry.snapshot";
        }

        if (topic.contains("/event/button")) {
            return normalizeButtonEvent(payloadNode);
        }
        if (topic.contains("/event/counter")) {
            return "counter.snapshot";
        }
        if (topic.contains("/event/sensor/ldr")) {
            return "sensor.ldr.voltage";
        }
        if (topic.contains("/event/sensor/dht22")) {
            return normalizeDht22Event(payloadNode);
        }
        if (topic.contains("/status/heartbeat")) {
            return "status.heartbeat";
        }
        if (topic.contains("/status/wifi")) {
            return "status.wifi";
        }

        if (topic.endsWith("/events/rpc")) {
            return normalizeRpcNotification(payloadNode);
        }
        if (topic.contains("/command/led/green")) {
            return "command.led.green";
        }
        if (topic.contains("/command/led/orange")) {
            return "command.led.orange";
        }
        if (topic.contains("/command/counter/reset")) {
            return "command.counter.reset";
        }
        if (topic.contains("/command/switch:0")) {
            return "command.led.green";
        }
        if (topic.contains("/command/switch:1")) {
            return "command.led.orange";
        }
        if (topic.contains("/command/switch:")) {
            return "command.led.changed";
        }
        if (topic.contains("/status/switch:0")) {
            return "led.green.state_changed";
        }
        if (topic.contains("/status/switch:1")) {
            return "led.orange.state_changed";
        }
        if (topic.contains("/status/switch:")) {
            return "led.state_changed";
        }
        if (topic.endsWith("/rpc")) {
            if (payloadNode.has("method")) {
                return "rpc.request";
            }
            if (payloadNode.has("result")) {
                return "rpc.reply";
            }
            if (payloadNode.has("error")) {
                return "rpc.error";
            }
            return "rpc.message";
        }

        if (topic.contains("/cmd/led/green")) {
            return "command.led.green";
        }
        if (topic.contains("/cmd/led/orange")) {
            return "command.led.orange";
        }
        if (topic.contains("/cmd/counter/reset")) {
            return "command.counter.reset";
        }

        return "internal.raw";
    }

    private String canonicalizeTopic(String rawTopic, String deviceId, String eventType) {
        if (rawTopic == null || rawTopic.isBlank()) {
            return rawTopic;
        }

        String normalized = rawTopic.trim();
        if (normalized.startsWith("epld/")) {
            String[] segments = normalized.split("/", 3);
            if (segments.length == 3 && !segments[1].isBlank()) {
                normalized = segments[1] + "/" + segments[2];
            } else if (segments.length == 2 && !segments[1].isBlank()) {
                normalized = segments[1];
            }
        }

        String resolvedDeviceId = (deviceId == null || deviceId.isBlank()) ? "unknown" : deviceId.trim();
        String topicDeviceId = extractTopicDeviceId(rawTopic);
        String canonicalTopicDeviceId = topicDeviceId == null || topicDeviceId.isBlank()
                ? resolvedDeviceId
                : topicDeviceId;
        if (eventType != null && !eventType.isBlank()) {
            String lowerEventType = eventType.toLowerCase(Locale.ROOT);
            if (lowerEventType.startsWith("button.")) {
                String[] parts = lowerEventType.split("\\.");
                String buttonName = parts.length >= 2 ? parts[1].trim() : "";
                if (buttonName.isBlank()) {
                    return canonicalTopicDeviceId + "/event/button";
                }
                return canonicalTopicDeviceId + "/event/button/" + buttonName;
            }
            if (lowerEventType.startsWith("sensor.temperature")) {
                return canonicalTopicDeviceId + "/event/sensor/temperature";
            }
            if (lowerEventType.startsWith("sensor.humidity")) {
                return canonicalTopicDeviceId + "/event/sensor/humidity";
            }
            if (lowerEventType.equals("command.led.green")) {
                return canonicalTopicDeviceId + "/command/led/green";
            }
            if (lowerEventType.equals("command.led.orange")) {
                return canonicalTopicDeviceId + "/command/led/orange";
            }
            if (lowerEventType.equals("command.counter.reset")) {
                return canonicalTopicDeviceId + "/command/counter/reset";
            }
            if (lowerEventType.equals("led.green.state_changed")) {
                return canonicalTopicDeviceId + "/event/led/green";
            }
            if (lowerEventType.equals("led.orange.state_changed")) {
                return canonicalTopicDeviceId + "/event/led/orange";
            }
        }

        if (!normalized.endsWith("/events/rpc")) {
            return normalized;
        }

        if (eventType == null || eventType.isBlank()) {
            return normalized;
        }
        String lowerEventType = eventType.toLowerCase(Locale.ROOT);
        if (lowerEventType.startsWith("counter.")) {
            return canonicalTopicDeviceId + "/event/counter";
        }
        if (lowerEventType.equals("sensor.ldr.voltage")) {
            return canonicalTopicDeviceId + "/event/sensor/ldr";
        }
        if (lowerEventType.startsWith("sensor.temperature")) {
            return canonicalTopicDeviceId + "/event/sensor/temperature";
        }
        if (lowerEventType.startsWith("sensor.humidity")) {
            return canonicalTopicDeviceId + "/event/sensor/humidity";
        }
        if (lowerEventType.startsWith("sensor.dht22")) {
            return canonicalTopicDeviceId + "/event/sensor/dht22";
        }
        if (lowerEventType.equals("led.green.state_changed")) {
            return canonicalTopicDeviceId + "/event/led/green";
        }
        if (lowerEventType.equals("led.orange.state_changed")) {
            return canonicalTopicDeviceId + "/event/led/orange";
        }
        if (lowerEventType.startsWith("status.")) {
            return canonicalTopicDeviceId + "/status/" + lowerEventType.substring("status.".length());
        }
        return normalized;
    }

    private String extractTopicDeviceId(String topic) {
        if (topic == null || topic.isBlank()) {
            return null;
        }
        String[] segments = topic.split("/");
        if (segments.length >= 2 && "epld".equals(segments[0])) {
            return normalizeDeviceId(segments[1]);
        }
        if (segments.length >= 1
                && (segments[0].startsWith("epld") || segments[0].startsWith("eplvd"))) {
            return normalizeDeviceId(segments[0]);
        }
        return null;
    }

    private String extractGroupKey(String deviceId, JsonNode payloadNode) {
        String payloadGroupKey = text(payloadNode, "groupKey");
        if (payloadGroupKey != null && !payloadGroupKey.isBlank()) {
            return payloadGroupKey;
        }
        return DeviceIdMapping.groupKeyForDevice(deviceId).orElse(deviceId);
    }

    private String normalizeButtonEvent(JsonNode payloadNode) {
        String button = safe(text(payloadNode, "button"));
        if (button == null || button.isBlank()) {
            button = safe(text(payloadNode, "name"));
        }
        if (button == null || button.isBlank()) {
            button = "unknown";
        }

        String action = safe(text(payloadNode, "action"));
        if (action == null || action.isBlank()) {
            JsonNode pressed = payloadNode.get("pressed");
            if (pressed != null && pressed.isBoolean()) {
                action = pressed.asBoolean() ? "press" : "release";
            }
        }
        if (action == null || action.isBlank()) {
            action = "changed";
        }

        return "button." + button + "." + action;
    }

    private String normalizeDht22Event(JsonNode payloadNode) {
        boolean hasTemperature = hasNumericValue(
                payloadNode.at("/temperature"),
                payloadNode.at("/temp"),
                payloadNode.at("/tC"),
                payloadNode.at("/temperatureC"),
                payloadNode.at("/params/temperature:100/value"),
                payloadNode.at("/params/temperature:100/tC")
        );
        boolean hasHumidity = hasNumericValue(
                payloadNode.at("/humidity"),
                payloadNode.at("/rh"),
                payloadNode.at("/humidityPct"),
                payloadNode.at("/params/humidity:100/value"),
                payloadNode.at("/params/humidity:100/rh")
        );

        if (hasTemperature && !hasHumidity) {
            return "sensor.temperature";
        }
        if (hasHumidity && !hasTemperature) {
            return "sensor.humidity";
        }

        String metricHint = safe(text(payloadNode, "metric"));
        if (metricHint.contains("temp")) {
            return "sensor.temperature";
        }
        if (metricHint.contains("humid")) {
            return "sensor.humidity";
        }

        String typeHint = safe(text(payloadNode, "type"));
        if (typeHint.contains("temp")) {
            return "sensor.temperature";
        }
        if (typeHint.contains("humid")) {
            return "sensor.humidity";
        }

        if (hasTemperature) {
            return "sensor.temperature";
        }
        if (hasHumidity) {
            return "sensor.humidity";
        }
        return "sensor.temperature";
    }

    private boolean hasNumericValue(JsonNode... nodes) {
        if (nodes == null) {
            return false;
        }
        for (JsonNode node : nodes) {
            if (node == null || node.isMissingNode() || node.isNull()) {
                continue;
            }
            if (node.isNumber()) {
                return true;
            }
            if (node.isTextual()) {
                String text = node.asText();
                if (text == null || text.isBlank()) {
                    continue;
                }
                try {
                    Double.parseDouble(text.trim());
                    return true;
                } catch (NumberFormatException ignored) {
                    // ignore non-numeric text values
                }
            }
        }
        return false;
    }

    private String normalizeRpcNotification(JsonNode payloadNode) {
        String method = text(payloadNode, "method");
        if ("NotifyEvent".equals(method)) {
            JsonNode firstEvent = payloadNode.at("/params/events/0");
            String component = text(firstEvent, "component");
            String event = text(firstEvent, "event");

            if ("input:2".equals(component) && "counts_reset".equals(event)) {
                return "counter.reset";
            }
            return "notify.event." + safe(component) + "." + safe(event);
        }

        if ("NotifyStatus".equals(method)) {
            JsonNode params = payloadNode.path("params");
            if (params.has("input:0")) {
                return stateToButtonEvent(params.path("input:0"), "button.red");
            }
            if (params.has("input:1")) {
                return stateToButtonEvent(params.path("input:1"), "button.black");
            }
            if (params.has("input:2")) {
                return "counter.snapshot";
            }
            if (params.has("switch:0")) {
                return "led.green.state_changed";
            }
            if (params.has("switch:1")) {
                return "led.orange.state_changed";
            }
            if (params.has("voltmeter:100")) {
                return "sensor.ldr.voltage";
            }
            if (params.has("temperature:100")) {
                return "sensor.temperature";
            }
            if (params.has("humidity:100")) {
                return "sensor.humidity";
            }
            if (params.has("mqtt")) {
                return "status.mqtt";
            }
            if (params.has("sys")) {
                return "status.system";
            }
            return "status.fragment";
        }

        return "rpc.notification";
    }

    private String stateToButtonEvent(JsonNode node, String prefix) {
        JsonNode stateNode = node.get("state");
        if (stateNode != null && stateNode.isBoolean()) {
            return prefix + (stateNode.asBoolean() ? ".press" : ".release");
        }
        return prefix + ".changed";
    }

    private EventCategory categorize(String topic, String eventType) {
        if (eventType.startsWith("button.")) {
            return EventCategory.BUTTON;
        }
        if (eventType.startsWith("counter.")) {
            return EventCategory.COUNTER;
        }
        if (eventType.startsWith("led.")) {
            return EventCategory.STATUS;
        }
        if (eventType.startsWith("sensor.") || eventType.startsWith("telemetry.")) {
            return EventCategory.SENSOR;
        }
        if (eventType.startsWith("command.") || eventType.equals("simple_control.command") || topic.contains("/cmd/")
                || topic.contains("/command/")) {
            return EventCategory.COMMAND;
        }
        if (eventType.startsWith("rpc.reply") || eventType.startsWith("rpc.error") || topic.contains("/ack/")) {
            return EventCategory.ACK;
        }
        if (eventType.startsWith("status.") || eventType.startsWith("device.online") || topic.contains("/status/")) {
            return EventCategory.STATUS;
        }
        return EventCategory.INTERNAL;
    }

    private boolean isInternal(String topic, EventCategory category, String eventType) {
        return category == EventCategory.INTERNAL
                || category == EventCategory.ACK
                || topic.startsWith("epl/probe/")
                || eventType.startsWith("rpc.")
                || eventType.startsWith("simple_control.")
                || eventType.startsWith("device.online")
                || eventType.startsWith("device.offline")
                || eventType.startsWith("status.system")
                || topic.endsWith("/online")
                || topic.endsWith("/offline")
                || topic.contains("/status/system");
    }

    private Instant extractDeviceTimestamp(JsonNode payloadNode) {
        Instant parsed = parseTimestamp(payloadNode.at("/params/ts"));
        if (parsed != null) {
            return parsed;
        }
        parsed = parseTimestamp(payloadNode.get("ts"));
        if (parsed != null) {
            return parsed;
        }
        parsed = parseTimestamp(payloadNode.at("/params/events/0/ts"));
        if (parsed != null) {
            return parsed;
        }
        parsed = parseTimestamp(payloadNode.get("timestamp"));
        if (parsed != null) {
            return parsed;
        }
        return null;
    }

    private Instant parseTimestamp(JsonNode valueNode) {
        if (valueNode == null || valueNode.isMissingNode() || valueNode.isNull()) {
            return null;
        }
        try {
            if (valueNode.isNumber()) {
                double value = valueNode.asDouble();
                if (value > 10_000_000_000d) {
                    return Instant.ofEpochMilli((long) value);
                }
                long seconds = (long) value;
                long nanos = (long) ((value - seconds) * 1_000_000_000L);
                return Instant.ofEpochSecond(seconds, nanos);
            }
            if (valueNode.isTextual()) {
                String text = valueNode.asText();
                if (text.matches("\\d+")) {
                    long number = Long.parseLong(text);
                    if (number > 10_000_000_000L) {
                        return Instant.ofEpochMilli(number);
                    }
                    return Instant.ofEpochSecond(number);
                }
                return Instant.parse(text);
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private Long extractSequenceNo(JsonNode payloadNode) {
        JsonNode idNode = payloadNode.get("id");
        if (idNode != null && idNode.isNumber()) {
            return idNode.asLong();
        }
        JsonNode eventIdNode = payloadNode.at("/params/events/0/id");
        if (eventIdNode != null && eventIdNode.isNumber()) {
            return eventIdNode.asLong();
        }
        return null;
    }

    private Boolean extractExplicitOnline(String topic, JsonNode payloadNode) {
        if (!topic.endsWith("/online")) {
            return null;
        }

        if (payloadNode.isBoolean()) {
            return payloadNode.asBoolean();
        }
        if (payloadNode.isTextual()) {
            String text = payloadNode.asText().toLowerCase(Locale.ROOT);
            if ("true".equals(text)) {
                return true;
            }
            if ("false".equals(text)) {
                return false;
            }
        }
        if (payloadNode.has("online") && payloadNode.get("online").isBoolean()) {
            return payloadNode.get("online").asBoolean();
        }

        return null;
    }

    private String text(JsonNode node, String fieldName) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        JsonNode field = node.get(fieldName);
        if (field == null || field.isNull()) {
            return null;
        }
        return field.asText();
    }

    private String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        return node.asText();
    }

    private String safe(String value) {
        if (value == null || value.isBlank()) {
            return "unknown";
        }
        return value.toLowerCase(Locale.ROOT)
                .replace(':', '.')
                .replace('/', '.')
                .replace(' ', '_');
    }

    private String toJson(JsonNode payloadNode) {
        try {
            return objectMapper.writeValueAsString(payloadNode);
        } catch (JsonProcessingException ex) {
            return "{}";
        }
    }
}
