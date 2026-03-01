package ch.marcovogt.epl.authsession;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuthAccountRepository extends JpaRepository<AuthAccount, String> {

    Optional<AuthAccount> findByUsernameAndEnabledTrue(String username);
    Optional<AuthAccount> findByUsernameIgnoreCaseAndEnabledTrue(String username);

    Optional<AuthAccount> findByUsernameAndRoleAndEnabledTrue(String username, AppRole role);

    List<AuthAccount> findByRoleAndEnabledTrueOrderByUsernameAsc(AppRole role);
}
