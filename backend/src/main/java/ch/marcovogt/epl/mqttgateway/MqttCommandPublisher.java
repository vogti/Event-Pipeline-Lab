package ch.marcovogt.epl.mqttgateway;

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
        mqttGatewayClient.publish(deviceId + "/command/switch:0", on ? "on" : "off", 1, false);
        publishRpc(
                deviceId,
                "Switch.Set",
                "{\"id\":0,\"on\":" + (on ? "true" : "false") + "}"
        );
    }

    public void publishLedOrange(String deviceId, boolean on) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/led/orange", on ? "on" : "off", 1, false);
        mqttGatewayClient.publish(deviceId + "/command/switch:1", on ? "on" : "off", 1, false);
        publishRpc(
                deviceId,
                "Switch.Set",
                "{\"id\":1,\"on\":" + (on ? "true" : "false") + "}"
        );
    }

    public void publishCounterReset(String deviceId) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/counter/reset", "{}", 1, false);
        publishRpc(
                deviceId,
                "Input.ResetCounters",
                "{\"id\":2,\"type\":[\"counter\"]}"
        );
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
}
