package ch.marcovogt.epl.deviceregistryhealth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthAccount;
import ch.marcovogt.epl.authsession.AuthAccountRepository;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceState;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceStateRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DeviceDiscoveryProvisioningServiceTest {

    @Mock
    private AuthAccountRepository authAccountRepository;

    @Mock
    private VirtualDeviceStateRepository virtualDeviceStateRepository;

    @InjectMocks
    private DeviceDiscoveryProvisioningService service;

    @Test
    void shouldProvisionStudentAccountAndVirtualDeviceForNewPhysicalDevice() {
        when(authAccountRepository.findById("epld12")).thenReturn(Optional.empty());
        when(virtualDeviceStateRepository.findById("eplvd12")).thenReturn(Optional.empty());
        when(authAccountRepository.save(any(AuthAccount.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(virtualDeviceStateRepository.save(any(VirtualDeviceState.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.ensureProvisionedForPhysicalDevice("epld12");

        ArgumentCaptor<AuthAccount> accountCaptor = ArgumentCaptor.forClass(AuthAccount.class);
        verify(authAccountRepository).save(accountCaptor.capture());
        AuthAccount savedAccount = accountCaptor.getValue();
        assertThat(savedAccount.getUsername()).isEqualTo("epld12");
        assertThat(savedAccount.getRole()).isEqualTo(AppRole.STUDENT);
        assertThat(savedAccount.getGroupKey()).isEqualTo("epld12");
        assertThat(savedAccount.getPinCode()).matches("\\d{4}");

        ArgumentCaptor<VirtualDeviceState> virtualCaptor = ArgumentCaptor.forClass(VirtualDeviceState.class);
        verify(virtualDeviceStateRepository).save(virtualCaptor.capture());
        VirtualDeviceState virtualState = virtualCaptor.getValue();
        assertThat(virtualState.getDeviceId()).isEqualTo("eplvd12");
        assertThat(virtualState.getGroupKey()).isEqualTo("epld12");
        assertThat(virtualState.isOnline()).isTrue();
    }

    @Test
    void shouldIgnoreNonPhysicalDeviceIds() {
        service.ensureProvisionedForPhysicalDevice("eplvd03");

        verify(authAccountRepository, never()).findById(anyString());
        verify(authAccountRepository, never()).save(any());
        verify(virtualDeviceStateRepository, never()).findById(anyString());
        verify(virtualDeviceStateRepository, never()).save(any());
    }
}
