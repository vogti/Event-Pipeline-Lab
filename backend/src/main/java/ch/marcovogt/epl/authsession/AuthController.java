package ch.marcovogt.epl.authsession;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.time.Duration;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final String SESSION_COOKIE = "EPL_SESSION";

    private final AuthService authService;
    private final RequestAuth requestAuth;
    private final RealtimeSyncService realtimeSyncService;

    public AuthController(
            AuthService authService,
            RequestAuth requestAuth,
            RealtimeSyncService realtimeSyncService
    ) {
        this.authService = authService;
        this.requestAuth = requestAuth;
        this.realtimeSyncService = realtimeSyncService;
    }

    @PostMapping("/login")
    public AuthMeResponse login(
            @Valid @RequestBody LoginRequest request,
            HttpServletResponse response
    ) {
        SessionPrincipal principal = authService.login(request.username().trim(), request.pin().trim());
        setSessionCookie(response, principal.sessionToken(), Duration.ofHours(8));
        if (principal.role() == AppRole.STUDENT && principal.groupKey() != null) {
            realtimeSyncService.broadcastPresence(principal.groupKey());
        }
        return AuthMeResponse.from(principal);
    }

    @PostMapping("/logout")
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        SessionPrincipal principal = requestAuth.requireAny(request);
        authService.logout(principal.sessionToken());
        setSessionCookie(response, "", Duration.ZERO);
        if (principal.role() == AppRole.STUDENT && principal.groupKey() != null) {
            realtimeSyncService.broadcastPresence(principal.groupKey());
        }
    }

    @GetMapping("/me")
    public AuthMeResponse me(HttpServletRequest request) {
        return AuthMeResponse.from(requestAuth.requireAny(request));
    }

    @PostMapping("/display-name")
    public AuthMeResponse updateDisplayName(
            HttpServletRequest request,
            @Valid @RequestBody DisplayNameRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.STUDENT);
        SessionPrincipal updated = authService.updateDisplayName(principal, body.displayName());
        realtimeSyncService.broadcastPresence(updated.groupKey());
        return AuthMeResponse.from(updated);
    }

    private void setSessionCookie(HttpServletResponse response, String token, Duration maxAge) {
        ResponseCookie cookie = ResponseCookie.from(SESSION_COOKIE, token)
                .path("/")
                .httpOnly(false)
                .sameSite("Lax")
                .maxAge(maxAge)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
