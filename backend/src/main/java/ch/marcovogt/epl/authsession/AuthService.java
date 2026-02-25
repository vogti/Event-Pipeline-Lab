package ch.marcovogt.epl.authsession;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final AuthAccountRepository authAccountRepository;
    private final AuthSessionRepository authSessionRepository;
    private final Duration sessionTtl;
    private final Duration presenceWindow;
    private final Clock clock;

    public AuthService(
            AuthAccountRepository authAccountRepository,
            AuthSessionRepository authSessionRepository,
            @Value("${epl.auth.session-ttl:PT8H}") Duration sessionTtl,
            @Value("${epl.auth.presence-window:PT45S}") Duration presenceWindow
    ) {
        this.authAccountRepository = authAccountRepository;
        this.authSessionRepository = authSessionRepository;
        this.sessionTtl = sessionTtl;
        this.presenceWindow = presenceWindow;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public SessionPrincipal login(String username, String pin) {
        AuthAccount account = authAccountRepository.findByUsernameAndEnabledTrue(username)
                .orElseThrow(() -> AuthExceptions.invalidCredentials());

        if (!account.getPinCode().equals(pin)) {
            throw AuthExceptions.invalidCredentials();
        }

        Instant now = Instant.now(clock);
        AuthSession session = new AuthSession();
        session.setSessionToken(UUID.randomUUID());
        session.setUsername(account.getUsername());
        session.setRole(account.getRole());
        session.setGroupKey(account.getGroupKey());
        session.setDisplayName(defaultDisplayName(account.getRole(), account.getUsername()));
        session.setCreatedAt(now);
        session.setLastSeen(now);
        session.setExpiresAt(now.plus(sessionTtl));
        session.setActive(true);

        return toPrincipal(authSessionRepository.save(session));
    }

    @Transactional
    public Optional<SessionPrincipal> resolveAndTouch(String token) {
        UUID sessionId = parseToken(token).orElse(null);
        if (sessionId == null) {
            return Optional.empty();
        }

        Optional<AuthSession> optional = authSessionRepository.findBySessionTokenAndActiveTrue(sessionId);
        if (optional.isEmpty()) {
            return Optional.empty();
        }

        AuthSession session = optional.get();
        Instant now = Instant.now(clock);
        if (session.getExpiresAt().isBefore(now)) {
            session.setActive(false);
            authSessionRepository.save(session);
            return Optional.empty();
        }

        session.setLastSeen(now);
        session.setExpiresAt(now.plus(sessionTtl));
        return Optional.of(toPrincipal(authSessionRepository.save(session)));
    }

    @Transactional
    public void logout(String token) {
        parseToken(token)
                .flatMap(authSessionRepository::findBySessionTokenAndActiveTrue)
                .ifPresent(session -> {
                    session.setActive(false);
                    authSessionRepository.save(session);
                });
    }

    @Transactional
    public SessionPrincipal updateDisplayName(SessionPrincipal principal, String displayName) {
        AuthSession session = authSessionRepository.findById(UUID.fromString(principal.sessionToken()))
                .orElseThrow(() -> AuthExceptions.invalidSession());

        session.setDisplayName(displayName.trim());
        return toPrincipal(authSessionRepository.save(session));
    }

    @Transactional(readOnly = true)
    public List<PresenceUserDto> listGroupPresence(String groupKey) {
        Instant cutoff = Instant.now(clock).minus(presenceWindow);
        return authSessionRepository
                .findByGroupKeyAndActiveTrueAndLastSeenAfterOrderByLastSeenDesc(groupKey, cutoff)
                .stream()
                .map(session -> new PresenceUserDto(
                        session.getUsername(),
                        session.getDisplayName(),
                        session.getLastSeen()
                ))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<String> listStudentGroupKeys() {
        return authAccountRepository.findByRoleOrderByUsernameAsc(AppRole.STUDENT)
                .stream()
                .map(AuthAccount::getGroupKey)
                .filter(groupKey -> groupKey != null && !groupKey.isBlank())
                .distinct()
                .toList();
    }

    @Scheduled(fixedDelayString = "${epl.auth.cleanup-delay-ms:60000}")
    @Transactional
    public void cleanupExpiredSessions() {
        authSessionRepository.deactivateExpired(Instant.now(clock));
    }

    private Optional<UUID> parseToken(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }

        try {
            return Optional.of(UUID.fromString(token));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

    private String defaultDisplayName(AppRole role, String username) {
        if (role == AppRole.ADMIN) {
            return username;
        }

        String suffix = UUID.randomUUID().toString().substring(0, 6);
        return "student-" + suffix;
    }

    private SessionPrincipal toPrincipal(AuthSession session) {
        return new SessionPrincipal(
                session.getSessionToken().toString(),
                session.getUsername(),
                session.getRole(),
                session.getGroupKey(),
                session.getDisplayName(),
                session.getExpiresAt()
        );
    }
}
