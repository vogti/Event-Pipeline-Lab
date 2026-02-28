package ch.marcovogt.epl.groupcollaborationsync;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StudentPublishMqttEventRequest(
        @NotBlank @Size(max = 512) String topic,
        @NotBlank @Size(max = 65535) String payload,
        @Min(0) @Max(2) Integer qos,
        Boolean retained,
        @Size(max = 64) String targetDeviceId
) {
    public int resolvedQos() {
        return qos == null ? 1 : qos;
    }

    public boolean resolvedRetained() {
        return Boolean.TRUE.equals(retained);
    }
}
