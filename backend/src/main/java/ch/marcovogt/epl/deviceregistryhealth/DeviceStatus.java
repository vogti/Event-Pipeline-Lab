package ch.marcovogt.epl.deviceregistryhealth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "device_status")
public class DeviceStatus {

    @Id
    @Column(name = "device_id", nullable = false, length = 128)
    private String deviceId;

    @Column(nullable = false)
    private boolean online;

    @Column(name = "last_seen", nullable = false)
    private Instant lastSeen;

    @Column
    private Integer rssi;

    @Column(name = "wifi_payload_json", columnDefinition = "text")
    private String wifiPayloadJson;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public DeviceStatus() {
    }

    public DeviceStatus(String deviceId) {
        this.deviceId = deviceId;
        this.online = true;
        this.lastSeen = Instant.now();
    }

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

    public boolean isOnline() {
        return online;
    }

    public void setOnline(boolean online) {
        this.online = online;
    }

    public Instant getLastSeen() {
        return lastSeen;
    }

    public void setLastSeen(Instant lastSeen) {
        this.lastSeen = lastSeen;
    }

    public Integer getRssi() {
        return rssi;
    }

    public void setRssi(Integer rssi) {
        this.rssi = rssi;
    }

    public String getWifiPayloadJson() {
        return wifiPayloadJson;
    }

    public void setWifiPayloadJson(String wifiPayloadJson) {
        this.wifiPayloadJson = wifiPayloadJson;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
