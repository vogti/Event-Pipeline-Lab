package ch.marcovogt.epl.virtualdevice;

import java.time.Instant;

public record VirtualDeviceStateDto(
        String deviceId,
        String groupKey,
        boolean online,
        int rssi,
        String ipAddress,
        double temperatureC,
        double humidityPct,
        double brightness,
        long counterValue,
        boolean buttonRedPressed,
        boolean buttonBlackPressed,
        boolean ledGreenOn,
        boolean ledOrangeOn,
        Instant updatedAt
) {
    public static VirtualDeviceStateDto from(VirtualDeviceState state) {
        return new VirtualDeviceStateDto(
                state.getDeviceId(),
                state.getGroupKey(),
                state.isOnline(),
                state.getRssi(),
                state.getIpAddress(),
                state.getTemperatureC(),
                state.getHumidityPct(),
                state.getBrightness(),
                state.getCounterValue(),
                state.isButtonRedPressed(),
                state.isButtonBlackPressed(),
                state.isLedGreenOn(),
                state.isLedOrangeOn(),
                state.getUpdatedAt()
        );
    }
}
