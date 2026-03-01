package ch.marcovogt.epl.externalsources;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "epl.external.wikimedia")
public class WikimediaEventStreamProperties {

    private int connectTimeoutMs = 5000;
    private int readTimeoutMs = 3000;
    private long reconnectDelayMs = 3000;
    private long disabledPollDelayMs = 1500;
    private int maxPayloadBytes = 524_288;
    private String userAgent = "EventPipelineLab/1.0";

    public int getConnectTimeoutMs() {
        return connectTimeoutMs;
    }

    public void setConnectTimeoutMs(int connectTimeoutMs) {
        this.connectTimeoutMs = connectTimeoutMs;
    }

    public int getReadTimeoutMs() {
        return readTimeoutMs;
    }

    public void setReadTimeoutMs(int readTimeoutMs) {
        this.readTimeoutMs = readTimeoutMs;
    }

    public long getReconnectDelayMs() {
        return reconnectDelayMs;
    }

    public void setReconnectDelayMs(long reconnectDelayMs) {
        this.reconnectDelayMs = reconnectDelayMs;
    }

    public long getDisabledPollDelayMs() {
        return disabledPollDelayMs;
    }

    public void setDisabledPollDelayMs(long disabledPollDelayMs) {
        this.disabledPollDelayMs = disabledPollDelayMs;
    }

    public int getMaxPayloadBytes() {
        return maxPayloadBytes;
    }

    public void setMaxPayloadBytes(int maxPayloadBytes) {
        this.maxPayloadBytes = maxPayloadBytes;
    }

    public String getUserAgent() {
        return userAgent;
    }

    public void setUserAgent(String userAgent) {
        this.userAgent = userAgent;
    }
}
