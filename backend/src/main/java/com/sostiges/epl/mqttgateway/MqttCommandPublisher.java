package com.sostiges.epl.mqttgateway;

import org.springframework.stereotype.Service;

@Service
public class MqttCommandPublisher {

    private final MqttGatewayClient mqttGatewayClient;

    public MqttCommandPublisher(MqttGatewayClient mqttGatewayClient) {
        this.mqttGatewayClient = mqttGatewayClient;
    }

    public void publishLedGreen(String deviceId, boolean on) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/led/green", on ? "on" : "off", 1, false);
    }

    public void publishLedOrange(String deviceId, boolean on) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/led/orange", on ? "on" : "off", 1, false);
    }

    public void publishCounterReset(String deviceId) {
        mqttGatewayClient.publish("epld/" + deviceId + "/cmd/counter/reset", "{}", 1, false);
    }
}
