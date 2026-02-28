package ch.marcovogt.epl.deviceregistryhealth;

import java.time.Instant;

public record StudentDeviceStateDto(
        String deviceId,
        boolean online,
        Instant lastSeen,
        Integer rssi,
        Double temperatureC,
        Double humidityPct,
        Double brightness,
        Double counterValue,
        Boolean buttonRedPressed,
        Boolean buttonBlackPressed,
        Boolean ledGreenOn,
        Boolean ledOrangeOn,
        Long uptimeMs,
        Instant uptimeIngestTs,
        Instant updatedAt
) {
}
