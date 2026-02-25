package ch.marcovogt.epl.common;

import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class DeviceIdMapping {

    private static final Pattern EPLD_PATTERN = Pattern.compile("^epld(\\d+)$");
    private static final Pattern EPLVD_PATTERN = Pattern.compile("^eplvd(\\d+)$");

    private DeviceIdMapping() {
    }

    public static boolean isVirtualDeviceId(String deviceId) {
        return parseVirtualSuffix(deviceId).isPresent();
    }

    public static boolean isPhysicalDeviceId(String deviceId) {
        return parsePhysicalSuffix(deviceId).isPresent();
    }

    public static Optional<String> groupKeyForDevice(String deviceId) {
        if (deviceId == null || deviceId.isBlank()) {
            return Optional.empty();
        }
        if (isVirtualDeviceId(deviceId)) {
            return parseVirtualSuffix(deviceId).map(suffix -> "epld" + suffix);
        }
        return Optional.of(deviceId);
    }

    public static Optional<String> virtualDeviceIdForGroup(String groupKey) {
        if (groupKey == null || groupKey.isBlank()) {
            return Optional.empty();
        }

        Matcher matcher = EPLD_PATTERN.matcher(groupKey);
        if (!matcher.matches()) {
            return Optional.empty();
        }

        int index = Integer.parseInt(matcher.group(1));
        if (index < 1) {
            return Optional.empty();
        }

        return Optional.of("eplvd" + matcher.group(1));
    }

    private static Optional<String> parsePhysicalSuffix(String deviceId) {
        if (deviceId == null) {
            return Optional.empty();
        }

        Matcher matcher = EPLD_PATTERN.matcher(deviceId);
        if (!matcher.matches()) {
            return Optional.empty();
        }

        int index = Integer.parseInt(matcher.group(1));
        if (index < 1) {
            return Optional.empty();
        }

        return Optional.of(matcher.group(1));
    }

    private static Optional<String> parseVirtualSuffix(String deviceId) {
        if (deviceId == null) {
            return Optional.empty();
        }

        Matcher matcher = EPLVD_PATTERN.matcher(deviceId);
        if (!matcher.matches()) {
            return Optional.empty();
        }

        int index = Integer.parseInt(matcher.group(1));
        if (index < 1) {
            return Optional.empty();
        }

        return Optional.of(matcher.group(1));
    }
}
