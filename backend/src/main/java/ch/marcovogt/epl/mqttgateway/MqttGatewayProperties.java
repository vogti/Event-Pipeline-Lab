package ch.marcovogt.epl.mqttgateway;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "epl.mqtt")
public class MqttGatewayProperties {

    private String brokerUri = "tcp://localhost:1883";
    private String clientId = "epl-backend";
    private String username;
    private String password;
    private List<String> topicFilters = new ArrayList<>(List.of("epld/+/event/#", "epld/+/status/#"));
    private int qos = 1;
    private long reconnectDelayMs = 5000;
    private boolean cleanSession = true;
    private boolean appendRandomClientSuffix = true;

    public String getBrokerUri() {
        return brokerUri;
    }

    public void setBrokerUri(String brokerUri) {
        this.brokerUri = brokerUri;
    }

    public String getClientId() {
        return clientId;
    }

    public void setClientId(String clientId) {
        this.clientId = clientId;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public List<String> getTopicFilters() {
        return topicFilters;
    }

    public void setTopicFilters(List<String> topicFilters) {
        this.topicFilters = topicFilters;
    }

    public int getQos() {
        return qos;
    }

    public void setQos(int qos) {
        this.qos = qos;
    }

    public long getReconnectDelayMs() {
        return reconnectDelayMs;
    }

    public void setReconnectDelayMs(long reconnectDelayMs) {
        this.reconnectDelayMs = reconnectDelayMs;
    }

    public boolean isCleanSession() {
        return cleanSession;
    }

    public void setCleanSession(boolean cleanSession) {
        this.cleanSession = cleanSession;
    }

    public boolean isAppendRandomClientSuffix() {
        return appendRandomClientSuffix;
    }

    public void setAppendRandomClientSuffix(boolean appendRandomClientSuffix) {
        this.appendRandomClientSuffix = appendRandomClientSuffix;
    }

    public String resolveClientId() {
        if (!appendRandomClientSuffix) {
            return clientId;
        }
        return clientId + "-" + UUID.randomUUID().toString().substring(0, 8);
    }
}
