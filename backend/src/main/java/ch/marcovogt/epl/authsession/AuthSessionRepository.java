package ch.marcovogt.epl.authsession;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuthSessionRepository extends JpaRepository<AuthSession, UUID> {

    Optional<AuthSession> findBySessionTokenAndActiveTrue(UUID sessionToken);

    List<AuthSession> findByGroupKeyAndActiveTrueAndLastSeenAfterOrderByLastSeenDesc(String groupKey, Instant cutoff);

    @Modifying
    @Query("""
            update AuthSession s
            set s.active = false
            where s.active = true and s.expiresAt < :now
            """)
    int deactivateExpired(@Param("now") Instant now);
}
