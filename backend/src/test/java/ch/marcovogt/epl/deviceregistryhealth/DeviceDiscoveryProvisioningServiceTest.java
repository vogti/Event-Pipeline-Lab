package ch.marcovogt.epl.deviceregistryhealth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthAccount;
import ch.marcovogt.epl.authsession.AuthAccountRepository;
import ch.marcovogt.epl.authsession.AuthSessionRepository;
import ch.marcovogt.epl.groupcollaborationsync.GroupStateRepository;
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
    private AppSettingsService appSettingsService;

    @Mock
    private DeviceStatusRepository deviceStatusRepository;

    @Mock
    private AuthAccountRepository authAccountRepository;

    @Mock
    private AuthSessionRepository authSessionRepository;

    @Mock
    private GroupStateRepository groupStateRepository;

    @Mock
    private VirtualDeviceStateRepository virtualDeviceStateRepository;

    @InjectMocks
    private DeviceDiscoveryProvisioningService service;

    @Test
    void shouldProvisionStudentAccountAndVirtualDeviceForNewPhysicalDevice() {
        when(appSettingsService.isAdminDevice("epld12")).thenReturn(false);
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

        verify(appSettingsService, never()).isAdminDevice(anyString());
        verify(authAccountRepository, never()).findById(anyString());
        verify(authAccountRepository, never()).save(any());
        verify(virtualDeviceStateRepository, never()).findById(anyString());
        verify(virtualDeviceStateRepository, never()).save(any());
    }

    @Test
    void shouldKeepVirtualDeviceProvisionedForAdminDeviceAndDisableStudentAccess() {
        AuthAccount existing = new AuthAccount();
        existing.setUsername("epld01");
        existing.setPinCode("1234");
        existing.setRole(AppRole.STUDENT);
        existing.setGroupKey("epld01");
        existing.setEnabled(true);

        when(appSettingsService.isAdminDevice("epld01")).thenReturn(true);
        when(authAccountRepository.findById("epld01")).thenReturn(Optional.of(existing));
        when(virtualDeviceStateRepository.findById("eplvd01")).thenReturn(Optional.empty());
        when(authAccountRepository.save(any(AuthAccount.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(virtualDeviceStateRepository.save(any(VirtualDeviceState.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.ensureProvisionedForPhysicalDevice("epld01");

        ArgumentCaptor<AuthAccount> accountCaptor = ArgumentCaptor.forClass(AuthAccount.class);
        verify(authAccountRepository).save(accountCaptor.capture());
        AuthAccount savedAccount = accountCaptor.getValue();
        assertThat(savedAccount.getUsername()).isEqualTo("epld01");
        assertThat(savedAccount.getRole()).isEqualTo(AppRole.STUDENT);
        assertThat(savedAccount.isEnabled()).isFalse();
        assertThat(savedAccount.getGroupKey()).isNull();

        ArgumentCaptor<VirtualDeviceState> virtualCaptor = ArgumentCaptor.forClass(VirtualDeviceState.class);
        verify(virtualDeviceStateRepository).save(virtualCaptor.capture());
        VirtualDeviceState virtualState = virtualCaptor.getValue();
        assertThat(virtualState.getDeviceId()).isEqualTo("eplvd01");
        assertThat(virtualState.getGroupKey()).isEqualTo("epld01");
        assertThat(virtualState.isOnline()).isTrue();

        verify(authSessionRepository).deactivateByUsername("epld01");
        verify(groupStateRepository).deleteById("epld01");
        verify(virtualDeviceStateRepository, never()).deleteById(anyString());
    }
}
