package ch.marcovogt.epl.deviceregistryhealth;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthAccount;
import ch.marcovogt.epl.authsession.AuthAccountRepository;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceState;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceStateRepository;
import java.security.SecureRandom;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DeviceDiscoveryProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(DeviceDiscoveryProvisioningService.class);

    private final AuthAccountRepository authAccountRepository;
    private final VirtualDeviceStateRepository virtualDeviceStateRepository;
    private final SecureRandom secureRandom = new SecureRandom();

    public DeviceDiscoveryProvisioningService(
            AuthAccountRepository authAccountRepository,
            VirtualDeviceStateRepository virtualDeviceStateRepository
    ) {
        this.authAccountRepository = authAccountRepository;
        this.virtualDeviceStateRepository = virtualDeviceStateRepository;
    }

    @Transactional
    public void ensureProvisionedForPhysicalDevice(String physicalDeviceId) {
        if (!DeviceIdMapping.isPhysicalDeviceId(physicalDeviceId)) {
            return;
        }

        ensureStudentGroupAccount(physicalDeviceId);
        ensureVirtualDevice(physicalDeviceId);
    }

    private void ensureStudentGroupAccount(String deviceId) {
        var existing = authAccountRepository.findById(deviceId);
        if (existing.isPresent()) {
            AuthAccount account = existing.get();
            if (account.getRole() != AppRole.STUDENT) {
                log.warn(
                        "Skipping student provisioning for deviceId={} because existing account role is {}",
                        deviceId,
                        account.getRole()
                );
                return;
            }

            boolean changed = false;
            if (!deviceId.equals(account.getGroupKey())) {
                account.setGroupKey(deviceId);
                changed = true;
            }
            if (!account.isEnabled()) {
                account.setEnabled(true);
                changed = true;
            }

            if (changed) {
                authAccountRepository.save(account);
                log.info("Aligned student account for discovered device={}", deviceId);
            }
            return;
        }

        String pin = generateFourDigitPin();
        AuthAccount created = new AuthAccount();
        created.setUsername(deviceId);
        created.setPinCode(pin);
        created.setRole(AppRole.STUDENT);
        created.setGroupKey(deviceId);
        created.setEnabled(true);
        authAccountRepository.save(created);
        log.info("Provisioned student account for new device={} with generated 4-digit PIN", deviceId);
    }

    private void ensureVirtualDevice(String groupKey) {
        String virtualDeviceId = DeviceIdMapping.virtualDeviceIdForGroup(groupKey).orElse(null);
        if (virtualDeviceId == null) {
            return;
        }

        var existing = virtualDeviceStateRepository.findById(virtualDeviceId);
        if (existing.isPresent()) {
            VirtualDeviceState state = existing.get();
            boolean changed = false;
            if (!groupKey.equals(state.getGroupKey())) {
                state.setGroupKey(groupKey);
                changed = true;
            }
            if (!state.isOnline()) {
                state.setOnline(true);
                changed = true;
            }
            if (changed) {
                virtualDeviceStateRepository.save(state);
                log.info("Aligned virtual device mapping {} -> {}", virtualDeviceId, groupKey);
            }
            return;
        }

        VirtualDeviceState created = new VirtualDeviceState();
        created.setDeviceId(virtualDeviceId);
        created.setGroupKey(groupKey);
        created.setOnline(true);
        created.setRssi(0);
        created.setIpAddress("virtual");
        created.setTemperatureC(22.5);
        created.setHumidityPct(46.0);
        created.setBrightness(1.65);
        created.setCounterValue(0L);
        created.setButtonRedPressed(false);
        created.setButtonBlackPressed(false);
        created.setLedGreenOn(false);
        created.setLedOrangeOn(false);
        virtualDeviceStateRepository.save(created);
        log.info("Provisioned virtual device={} for new group={}", virtualDeviceId, groupKey);
    }

    private String generateFourDigitPin() {
        return String.format(Locale.ROOT, "%04d", secureRandom.nextInt(10_000));
    }
}
