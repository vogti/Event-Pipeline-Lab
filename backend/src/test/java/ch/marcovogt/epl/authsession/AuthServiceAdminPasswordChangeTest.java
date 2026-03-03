package ch.marcovogt.epl.authsession;

import ch.marcovogt.epl.admin.AppSettingsService;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthServiceAdminPasswordChangeTest {

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
                Duration.ofHours(8),
                Duration.ofSeconds(45),
                Duration.ofSeconds(2)
        );
    }

    @Test
    void updateAdminPasswordShouldPersistNewPinWhenCurrentPasswordMatches() {
        AuthAccount admin = adminAccount("admin", "old123");
        when(authAccountRepository.findByUsernameAndRoleAndEnabledTrue("admin", AppRole.ADMIN))
                .thenReturn(Optional.of(admin));

        authService.updateAdminPassword("admin", "old123", "new123");

        assertThat(admin.getPinCode()).isEqualTo("new123");
        verify(authAccountRepository).save(admin);
    }

    @Test
    void updateAdminPasswordShouldRejectInvalidCurrentPassword() {
        AuthAccount admin = adminAccount("admin", "old123");
        when(authAccountRepository.findByUsernameAndRoleAndEnabledTrue("admin", AppRole.ADMIN))
                .thenReturn(Optional.of(admin));

        assertThatThrownBy(() -> authService.updateAdminPassword("admin", "wrong", "new123"))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
                .isEqualTo(401);

        verifyNoMoreInteractions(authSessionRepository, appSettingsService);
    }

    @Test
    void updateAdminPasswordShouldRejectSamePassword() {
        AuthAccount admin = adminAccount("admin", "same123");
        when(authAccountRepository.findByUsernameAndRoleAndEnabledTrue("admin", AppRole.ADMIN))
                .thenReturn(Optional.of(admin));

        assertThatThrownBy(() -> authService.updateAdminPassword("admin", "same123", "same123"))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
                .isEqualTo(400);
    }

    private AuthAccount adminAccount(String username, String pinCode) {
        AuthAccount account = new AuthAccount();
        account.setUsername(username);
        account.setPinCode(pinCode);
        account.setRole(AppRole.ADMIN);
        account.setEnabled(true);
        return account;
    }
}
