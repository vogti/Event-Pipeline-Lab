package ch.marcovogt.epl.authsession;

import ch.marcovogt.epl.admin.AppSettingsService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {

    private final AuthAccountRepository authAccountRepository;
    private final AuthSessionRepository authSessionRepository;
    private final AppSettingsService appSettingsService;
    private final Duration sessionTtl;
    private final Duration presenceWindow;
    private final Duration groupKeyCacheTtl;
    private final Clock clock;
    private volatile List<String> cachedStudentGroupKeys;
    private volatile Instant cachedStudentGroupKeysAt;

    public AuthService(
            AuthAccountRepository authAccountRepository,
            AuthSessionRepository authSessionRepository,
            AppSettingsService appSettingsService,
            @Value("${epl.auth.session-ttl:PT8H}") Duration sessionTtl,
            @Value("${epl.auth.presence-window:PT45S}") Duration presenceWindow,
            @Value("${epl.auth.group-key-cache-ttl:PT2S}") Duration groupKeyCacheTtl
    ) {
        this.authAccountRepository = authAccountRepository;
        this.authSessionRepository = authSessionRepository;
        this.appSettingsService = appSettingsService;
        this.sessionTtl = sessionTtl;
        this.presenceWindow = presenceWindow;
        this.groupKeyCacheTtl = sanitizeGroupKeyCacheTtl(groupKeyCacheTtl);
        this.clock = Clock.systemUTC();
        this.cachedStudentGroupKeys = List.of();
        this.cachedStudentGroupKeysAt = Instant.EPOCH;
    }

    @Transactional
    public SessionPrincipal login(String username, String pin) {
        String normalizedUsername = username == null ? "" : username.trim();
        AuthAccount account = authAccountRepository.findByUsernameIgnoreCaseAndEnabledTrue(normalizedUsername)
                .orElseThrow(() -> AuthExceptions.invalidCredentials());

        if (!account.getPinCode().equals(pin)) {
            throw AuthExceptions.invalidCredentials();
        }
        if (account.getRole() == AppRole.STUDENT && appSettingsService.isAdminDevice(account.getUsername())) {
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
        Instant now = Instant.now(clock);
        List<String> cached = cachedStudentGroupKeys;
        if (cached != null
                && !groupKeyCacheTtl.isZero()
                && now.isBefore(cachedStudentGroupKeysAt.plus(groupKeyCacheTtl))) {
            return cached;
        }
        return refreshStudentGroupKeys(now);
    }

    private List<String> refreshStudentGroupKeys(Instant now) {
        Instant snapshotTs = now == null ? Instant.now(clock) : now;
        String adminDeviceId = appSettingsService.getAdminDeviceId();
        List<String> resolved = authAccountRepository.findByRoleAndEnabledTrueOrderByUsernameAsc(AppRole.STUDENT)
                .stream()
                .map(AuthAccount::getGroupKey)
                .filter(groupKey -> groupKey != null && !groupKey.isBlank())
                .filter(groupKey -> adminDeviceId == null || !adminDeviceId.equalsIgnoreCase(groupKey))
                .distinct()
                .toList();
        cachedStudentGroupKeys = resolved;
        cachedStudentGroupKeysAt = snapshotTs;
        return resolved;
    }

    private Duration sanitizeGroupKeyCacheTtl(Duration ttl) {
        if (ttl == null || ttl.isNegative()) {
            return Duration.ZERO;
        }
        Duration max = Duration.ofSeconds(30);
        if (ttl.compareTo(max) > 0) {
            return max;
        }
        return ttl;
    }

    @Transactional(readOnly = true)
    public String getStudentGroupPin(String deviceId) {
        return findStudentGroupAccount(deviceId).getPinCode();
    }

    @Transactional
    public String updateStudentGroupPin(String deviceId, String pin) {
        String normalizedPin = normalizePinOrThrow(pin);

        AuthAccount account = findStudentGroupAccount(deviceId);
        account.setPinCode(normalizedPin);
        authAccountRepository.save(account);
        return normalizedPin;
    }

    @Transactional
    public void updateAdminPassword(String username, String currentPassword, String newPassword) {
        AuthAccount account = authAccountRepository.findByUsernameAndRoleAndEnabledTrue(username, AppRole.ADMIN)
                .orElseThrow(AuthExceptions::invalidSession);

        String normalizedCurrent = currentPassword == null ? "" : currentPassword.trim();
        if (!account.getPinCode().equals(normalizedCurrent)) {
            throw AuthExceptions.invalidCredentials();
        }

        String normalizedNew = normalizePinOrThrow(newPassword);
        if (normalizedNew.equals(normalizedCurrent)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "New password must be different");
        }

        account.setPinCode(normalizedNew);
        authAccountRepository.save(account);
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

    private AuthAccount findStudentGroupAccount(String deviceId) {
        return authAccountRepository.findByUsernameAndRoleAndEnabledTrue(deviceId, AppRole.STUDENT)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Unknown student group account: " + deviceId
                ));
    }

    private String normalizePinOrThrow(String pin) {
        String normalizedPin = pin == null ? "" : pin.trim();
        if (normalizedPin.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PIN must not be blank");
        }
        if (normalizedPin.length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PIN too long");
        }
        return normalizedPin;
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
