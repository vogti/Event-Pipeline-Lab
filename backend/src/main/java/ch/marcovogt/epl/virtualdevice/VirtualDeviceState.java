package ch.marcovogt.epl.virtualdevice;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "virtual_device_state")
public class VirtualDeviceState {

    @Id
    @Column(name = "device_id", nullable = false, length = 128)
    private String deviceId;

    @Column(name = "group_key", nullable = false, length = 128)
    private String groupKey;

    @Column(nullable = false)
    private boolean online;

    @Column(nullable = false)
    private int rssi;

    @Column(name = "ip_address", nullable = false, length = 64)
    private String ipAddress;

    @Column(name = "temperature_c", nullable = false)
    private double temperatureC;

    @Column(name = "humidity_pct", nullable = false)
    private double humidityPct;

    @Column(nullable = false)
    private double brightness;

    @Column(name = "counter_value", nullable = false)
    private long counterValue;

    @Column(name = "button_red_pressed", nullable = false)
    private boolean buttonRedPressed;

    @Column(name = "button_black_pressed", nullable = false)
    private boolean buttonBlackPressed;

    @Column(name = "led_green_on", nullable = false)
    private boolean ledGreenOn;

    @Column(name = "led_orange_on", nullable = false)
    private boolean ledOrangeOn;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void touchUpdatedAt() {
        this.updatedAt = Instant.now();
    }

    public String getDeviceId() {
        return deviceId;
    }

    public void setDeviceId(String deviceId) {
        this.deviceId = deviceId;
    }

    public String getGroupKey() {
        return groupKey;
    }

    public void setGroupKey(String groupKey) {
        this.groupKey = groupKey;
    }

    public boolean isOnline() {
        return online;
    }

    public void setOnline(boolean online) {
        this.online = online;
    }

    public int getRssi() {
        return rssi;
    }

    public void setRssi(int rssi) {
        this.rssi = rssi;
    }

    public String getIpAddress() {
        return ipAddress;
    }

    public void setIpAddress(String ipAddress) {
        this.ipAddress = ipAddress;
    }

    public double getTemperatureC() {
        return temperatureC;
    }

    public void setTemperatureC(double temperatureC) {
        this.temperatureC = temperatureC;
    }

    public double getHumidityPct() {
        return humidityPct;
    }

    public void setHumidityPct(double humidityPct) {
        this.humidityPct = humidityPct;
    }

    public double getBrightness() {
        return brightness;
    }

    public void setBrightness(double brightness) {
        this.brightness = brightness;
    }

    public long getCounterValue() {
        return counterValue;
    }

    public void setCounterValue(long counterValue) {
        this.counterValue = counterValue;
    }

    public boolean isButtonRedPressed() {
        return buttonRedPressed;
    }

    public void setButtonRedPressed(boolean buttonRedPressed) {
        this.buttonRedPressed = buttonRedPressed;
    }

    public boolean isButtonBlackPressed() {
        return buttonBlackPressed;
    }

    public void setButtonBlackPressed(boolean buttonBlackPressed) {
        this.buttonBlackPressed = buttonBlackPressed;
    }

    public boolean isLedGreenOn() {
        return ledGreenOn;
    }

    public void setLedGreenOn(boolean ledGreenOn) {
        this.ledGreenOn = ledGreenOn;
    }

    public boolean isLedOrangeOn() {
        return ledOrangeOn;
    }

    public void setLedOrangeOn(boolean ledOrangeOn) {
        this.ledOrangeOn = ledOrangeOn;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
