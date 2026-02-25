package ch.marcovogt.epl.virtualdevice;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;

public record VirtualDeviceControlRequest(
        Boolean buttonRedPressed,
        Boolean buttonBlackPressed,
        Boolean ledGreenOn,
        Boolean ledOrangeOn,
        @DecimalMin(value = "-40.0") @DecimalMax(value = "125.0") Double temperatureC,
        @DecimalMin(value = "0.0") @DecimalMax(value = "100.0") Double humidityPct,
        @DecimalMin(value = "0.0") @DecimalMax(value = "3.3") Double brightness,
        @Min(0) Long counterValue
) {

    public boolean isEmptyPatch() {
        return buttonRedPressed == null
                && buttonBlackPressed == null
                && ledGreenOn == null
                && ledOrangeOn == null
                && temperatureC == null
                && humidityPct == null
                && brightness == null
                && counterValue == null;
    }
}
