package ch.marcovogt.epl.authsession;

import ch.marcovogt.epl.admin.AppSettingsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthServiceCaseInsensitiveLoginTest {

    @Mock
    private AuthAccountRepository authAccountRepository;

    @Mock
    private AuthSessionRepository authSessionRepository;

    @Mock
    private AppSettingsService appSettingsService;

    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(
                authAccountRepository,
                authSessionRepository,
                appSettingsService,
                java.time.Duration.ofHours(8),
                java.time.Duration.ofSeconds(45),
                java.time.Duration.ofSeconds(2)
        );
    }

    @Test
    void loginShouldResolveUsernameCaseInsensitively() {
        AuthAccount account = new AuthAccount();
        account.setUsername("epld01");
        account.setPinCode("1234");
        account.setRole(AppRole.STUDENT);
        account.setGroupKey("epld01");
        account.setEnabled(true);

        when(authAccountRepository.findByUsernameIgnoreCaseAndEnabledTrue("EPLD01"))
                .thenReturn(Optional.of(account));
        when(appSettingsService.isAdminDevice("epld01")).thenReturn(false);
        when(authSessionRepository.save(any(AuthSession.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SessionPrincipal principal = authService.login("EPLD01", "1234");

        assertThat(principal.username()).isEqualTo("epld01");
        assertThat(principal.groupKey()).isEqualTo("epld01");

        verify(authAccountRepository).findByUsernameIgnoreCaseAndEnabledTrue("EPLD01");
        ArgumentCaptor<AuthSession> sessionCaptor = ArgumentCaptor.forClass(AuthSession.class);
        verify(authSessionRepository).save(sessionCaptor.capture());
        assertThat(sessionCaptor.getValue().getUsername()).isEqualTo("epld01");
    }

    @Test
    void listStudentGroupKeysShouldUseCacheWithinTtl() {
        AuthAccount groupAccount = new AuthAccount();
        groupAccount.setUsername("epld01");
        groupAccount.setRole(AppRole.STUDENT);
        groupAccount.setGroupKey("epld01");
        groupAccount.setEnabled(true);

        when(appSettingsService.getAdminDeviceId()).thenReturn(null);
        when(authAccountRepository.findByRoleAndEnabledTrueOrderByUsernameAsc(AppRole.STUDENT))
                .thenReturn(List.of(groupAccount));

        assertThat(authService.listStudentGroupKeys()).containsExactly("epld01");
        assertThat(authService.listStudentGroupKeys()).containsExactly("epld01");

        verify(authAccountRepository, times(1))
                .findByRoleAndEnabledTrueOrderByUsernameAsc(AppRole.STUDENT);
    }
}
