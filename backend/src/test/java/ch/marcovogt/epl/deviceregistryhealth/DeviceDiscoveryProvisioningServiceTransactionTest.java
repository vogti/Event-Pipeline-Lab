package ch.marcovogt.epl.deviceregistryhealth;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

class DeviceDiscoveryProvisioningServiceTransactionTest {

    @Test
    void reconcileOnStartupIsTransactional() throws NoSuchMethodException {
        Method method = DeviceDiscoveryProvisioningService.class.getMethod("reconcileOnStartup");
        assertThat(method.isAnnotationPresent(Transactional.class)).isTrue();
    }
}
