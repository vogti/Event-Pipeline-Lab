package ch.marcovogt.epl.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DeviceIdMappingTest {

    @Test
    void shouldMapVirtualDeviceToGroupKey() {
        assertThat(DeviceIdMapping.groupKeyForDevice("eplvd04")).contains("epld04");
        assertThat(DeviceIdMapping.isVirtualDeviceId("eplvd04")).isTrue();
    }

    @Test
    void shouldMapGroupKeyToVirtualDevice() {
        assertThat(DeviceIdMapping.virtualDeviceIdForGroup("epld10")).contains("eplvd10");
        assertThat(DeviceIdMapping.virtualDeviceIdForGroup("epld11")).isEmpty();
    }

    @Test
    void shouldTreatPhysicalAsOwnGroup() {
        assertThat(DeviceIdMapping.groupKeyForDevice("epld03")).contains("epld03");
        assertThat(DeviceIdMapping.isVirtualDeviceId("epld03")).isFalse();
    }
}
