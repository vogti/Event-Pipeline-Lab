package ch.marcovogt.epl.deviceregistryhealth;

import java.time.Instant;

public record DeviceStatusDto(
        String deviceId,
        boolean online,
        Instant lastSeen,
        Integer rssi,
        String wifiPayloadJson,
        Instant updatedAt
) {
    public static DeviceStatusDto from(DeviceStatus status) {
        return new DeviceStatusDto(
                status.getDeviceId(),
                status.isOnline(),
                status.getLastSeen(),
                status.getRssi(),
                status.getWifiPayloadJson(),
                status.getUpdatedAt()
        );
    }
}
