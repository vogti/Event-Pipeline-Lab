package ch.marcovogt.epl.mqttgateway;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Service;

@Service
public class MqttCommandPublisher {

    private final MqttGatewayClient mqttGatewayClient;
    private final AtomicLong rpcRequestId = new AtomicLong(1000);

    public MqttCommandPublisher(MqttGatewayClient mqttGatewayClient) {
        this.mqttGatewayClient = mqttGatewayClient;
    }

    public void publishLedGreen(String deviceId, boolean on) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/led/green", on ? "on" : "off", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/led/green", on ? "on" : "off", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/switch:0", on ? "on" : "off", 1, false);
        publishRpc(
                deviceId,
                "Switch.Set",
                "{\"id\":0,\"on\":" + (on ? "true" : "false") + "}"
        );
    }

    public void publishLedOrange(String deviceId, boolean on) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/led/orange", on ? "on" : "off", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/led/orange", on ? "on" : "off", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/switch:1", on ? "on" : "off", 1, false);
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

        if (publishNormalizedCommandTopicIfMatched(normalizedTopic, payload)) {
            return;
        }

        mqttGatewayClient.publish(normalizedTopic, payload, qos, retained);
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

    private boolean parseLedTargetState(String rawPayload) {
        String normalized = normalizePayloadToken(rawPayload);
        return switch (normalized) {
            case "on", "true", "1", "pressed", "press" -> true;
            case "off", "false", "0", "released", "release" -> false;
            default -> throw new IllegalArgumentException(
                    "Unsupported LED command payload. Use on/off, true/false, 1/0, pressed/released"
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
}
