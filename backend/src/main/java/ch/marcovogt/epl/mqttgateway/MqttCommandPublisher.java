package ch.marcovogt.epl.mqttgateway;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatus;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusRepository;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Service;

@Service
public class MqttCommandPublisher {

    private final MqttGatewayClient mqttGatewayClient;
    private final AuthService authService;
    private final AppSettingsService appSettingsService;
    private final DeviceStatusRepository deviceStatusRepository;
    private final PublishSourceContext publishSourceContext;
    private final AtomicLong rpcRequestId = new AtomicLong(1000);

    public MqttCommandPublisher(
            MqttGatewayClient mqttGatewayClient,
            AuthService authService,
            AppSettingsService appSettingsService,
            DeviceStatusRepository deviceStatusRepository,
            PublishSourceContext publishSourceContext
    ) {
        this.mqttGatewayClient = mqttGatewayClient;
        this.authService = authService;
        this.appSettingsService = appSettingsService;
        this.deviceStatusRepository = deviceStatusRepository;
        this.publishSourceContext = publishSourceContext;
    }

    public void publishLedGreen(String deviceId, boolean on) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/led/green", on ? "on" : "off", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/led/green", on ? "on" : "off", 1, false);
        publishRpc(
                deviceId,
                "Switch.Set",
                "{\"id\":0,\"on\":" + (on ? "true" : "false") + "}"
        );
    }

    public void publishLedOrange(String deviceId, boolean on) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/led/orange", on ? "on" : "off", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/led/orange", on ? "on" : "off", 1, false);
        publishRpc(
                deviceId,
                "Switch.Set",
                "{\"id\":1,\"on\":" + (on ? "true" : "false") + "}"
        );
    }

    public void publishCounterReset(String deviceId) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/counter/reset", "{}", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/counter/reset", "{}", 1, false);
        publishRpc(
                deviceId,
                "Input.ResetCounters",
                "{\"id\":2,\"type\":[\"counter\"]}"
        );
    }

    public void publishCustom(String topic, String payload, int qos, boolean retained) {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("topic must not be blank");
        }
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }
        if (qos < 0 || qos > 2) {
            throw new IllegalArgumentException("qos must be between 0 and 2");
        }

        String normalizedTopic = topic.trim();
        if (normalizedTopic.contains("+") || normalizedTopic.contains("#")) {
            throw new IllegalArgumentException("topic must not contain MQTT wildcards");
        }

        if (publishBroadcastCommandTopicIfMatched(normalizedTopic, payload, qos, retained)) {
            return;
        }

        if (publishNormalizedCommandTopicIfMatched(normalizedTopic, payload)) {
            return;
        }

        mqttGatewayClient.publish(normalizedTopic, payload, qos, retained);
    }

    private boolean publishBroadcastCommandTopicIfMatched(String topic, String payload, int qos, boolean retained) {
        BroadcastCommandType commandType = parseBroadcastCommandTopic(topic);
        if (commandType == null) {
            return false;
        }

        if (commandType == BroadcastCommandType.LED_GREEN || commandType == BroadcastCommandType.LED_ORANGE) {
            boolean targetOn = parseLedTargetState(payload);
            String normalizedPayload = targetOn ? "on" : "off";
            mqttGatewayClient.publish(topic, normalizedPayload, qos, retained);
            fanOutToPhysicalDevices(deviceId -> {
                if (commandType == BroadcastCommandType.LED_GREEN) {
                    publishLedGreen(deviceId, targetOn);
                } else {
                    publishLedOrange(deviceId, targetOn);
                }
            });
            return true;
        }

        if (commandType == BroadcastCommandType.COUNTER_RESET) {
            mqttGatewayClient.publish(topic, "{}", qos, retained);
            fanOutToPhysicalDevices(this::publishCounterReset);
            return true;
        }

        return false;
    }

    private boolean publishNormalizedCommandTopicIfMatched(String topic, String payload) {
        CommandTopic commandTopic = parseCommandTopic(topic);
        if (commandTopic == null) {
            return false;
        }

        if ("led_green".equals(commandTopic.commandType())) {
            publishLedGreen(commandTopic.deviceId(), parseLedTargetState(payload));
            return true;
        }
        if ("led_orange".equals(commandTopic.commandType())) {
            publishLedOrange(commandTopic.deviceId(), parseLedTargetState(payload));
            return true;
        }
        if ("counter_reset".equals(commandTopic.commandType())) {
            publishCounterReset(commandTopic.deviceId());
            return true;
        }
        return false;
    }

    private void fanOutToPhysicalDevices(DeviceCommandAction action) {
        for (String deviceId : resolveFanOutDeviceIds()) {
            publishSourceContext.runWithSource(PublishedEventSourceTracker.INTERNAL_FANOUT_SOURCE, () -> action.publish(deviceId));
        }
    }

    private List<String> resolveFanOutDeviceIds() {
        LinkedHashSet<String> deviceIds = new LinkedHashSet<>();
        List<DeviceStatus> discoveredStatuses = deviceStatusRepository.findAllByOrderByDeviceIdAsc();
        if (discoveredStatuses != null) {
            for (DeviceStatus status : discoveredStatuses) {
                if (status == null || status.getDeviceId() == null || status.getDeviceId().isBlank()) {
                    continue;
                }
                String normalized = status.getDeviceId().trim().toLowerCase(Locale.ROOT);
                if (DeviceIdMapping.isPhysicalDeviceId(normalized)) {
                    deviceIds.add(normalized);
                }
            }
        }
        for (String groupKey : authService.listStudentGroupKeys()) {
            if (groupKey == null || groupKey.isBlank()) {
                continue;
            }
            String normalized = groupKey.trim().toLowerCase(Locale.ROOT);
            if (DeviceIdMapping.isPhysicalDeviceId(normalized)) {
                deviceIds.add(normalized);
            }
        }
        String adminDeviceId = appSettingsService.getAdminDeviceId();
        if (adminDeviceId != null && !adminDeviceId.isBlank()) {
            String normalized = adminDeviceId.trim().toLowerCase(Locale.ROOT);
            if (DeviceIdMapping.isPhysicalDeviceId(normalized)) {
                deviceIds.add(normalized);
            }
        }
        return List.copyOf(deviceIds);
    }

    private CommandTopic parseCommandTopic(String topic) {
        String[] segments = topic.split("/", -1);
        if (segments.length == 4
                && equalsIgnoreCase(segments[1], "command")
                && equalsIgnoreCase(segments[2], "led")
                && !segments[0].isBlank()) {
            String color = segments[3].trim().toLowerCase(Locale.ROOT);
            if ("green".equals(color)) {
                return new CommandTopic(segments[0].trim(), "led_green");
            }
            if ("orange".equals(color)) {
                return new CommandTopic(segments[0].trim(), "led_orange");
            }
        }
        if (segments.length == 4
                && equalsIgnoreCase(segments[1], "command")
                && equalsIgnoreCase(segments[2], "counter")
                && equalsIgnoreCase(segments[3], "reset")
                && !segments[0].isBlank()) {
            return new CommandTopic(segments[0].trim(), "counter_reset");
        }

        if (segments.length == 5
                && equalsIgnoreCase(segments[0], "epld")
                && !segments[1].isBlank()
                && equalsIgnoreCase(segments[2], "command")
                && equalsIgnoreCase(segments[3], "led")) {
            String color = segments[4].trim().toLowerCase(Locale.ROOT);
            if ("green".equals(color)) {
                return new CommandTopic(segments[1].trim(), "led_green");
            }
            if ("orange".equals(color)) {
                return new CommandTopic(segments[1].trim(), "led_orange");
            }
        }
        if (segments.length == 5
                && equalsIgnoreCase(segments[0], "epld")
                && !segments[1].isBlank()
                && equalsIgnoreCase(segments[2], "command")
                && equalsIgnoreCase(segments[3], "counter")
                && equalsIgnoreCase(segments[4], "reset")) {
            return new CommandTopic(segments[1].trim(), "counter_reset");
        }

        return null;
    }

    private BroadcastCommandType parseBroadcastCommandTopic(String topic) {
        String normalized = topic == null ? "" : topic.trim();
        if (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        if (equalsIgnoreCase(normalized, "command/led/green")) {
            return BroadcastCommandType.LED_GREEN;
        }
        if (equalsIgnoreCase(normalized, "command/led/orange")) {
            return BroadcastCommandType.LED_ORANGE;
        }
        if (equalsIgnoreCase(normalized, "command/counter/reset")) {
            return BroadcastCommandType.COUNTER_RESET;
        }
        return null;
    }

    private boolean parseLedTargetState(String rawPayload) {
        String normalized = normalizePayloadToken(rawPayload);
        return switch (normalized) {
            case "on", "true", "1" -> true;
            case "off", "false", "0" -> false;
            default -> throw new IllegalArgumentException(
                    "Unsupported LED command payload. Use on/off, true/false, 1/0"
            );
        };
    }

    private String normalizePayloadToken(String rawPayload) {
        String value = rawPayload == null ? "" : rawPayload.trim();
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) {
            value = value.substring(1, value.length() - 1);
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private boolean equalsIgnoreCase(String left, String right) {
        return left != null && right != null && left.equalsIgnoreCase(right);
    }

    private void publishRpc(String deviceId, String method, String paramsJson) {
        long id = rpcRequestId.incrementAndGet();
        String payload = "{\"id\":" + id
                + ",\"src\":\"epl/backend\""
                + ",\"method\":\"" + method + "\""
                + ",\"params\":" + paramsJson
                + "}";
        mqttGatewayClient.publish(deviceId + "/rpc", payload, 1, false);
    }

    private record CommandTopic(String deviceId, String commandType) {
    }

    @FunctionalInterface
    private interface DeviceCommandAction {
        void publish(String deviceId);
    }

    private enum BroadcastCommandType {
        LED_GREEN,
        LED_ORANGE,
        COUNTER_RESET
    }
}
