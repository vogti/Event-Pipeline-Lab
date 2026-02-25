package ch.marcovogt.epl.authsession;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Arrays;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class RequestAuth {

    private static final String SESSION_HEADER = "X-EPL-Session";
    private static final String SESSION_COOKIE = "EPL_SESSION";

    private final AuthService authService;

    public RequestAuth(AuthService authService) {
        this.authService = authService;
    }

    public SessionPrincipal requireAny(HttpServletRequest request) {
        String token = extractToken(request).orElse(null);
        return authService.resolveAndTouch(token)
                .orElseThrow(AuthExceptions::invalidSession);
    }

    public SessionPrincipal requireRole(HttpServletRequest request, AppRole role) {
        SessionPrincipal principal = requireAny(request);
        if (principal.role() != role) {
            throw AuthExceptions.forbidden();
        }
        return principal;
    }

    public Optional<String> extractToken(HttpServletRequest request) {
        String headerValue = request.getHeader(SESSION_HEADER);
        if (headerValue != null && !headerValue.isBlank()) {
            return Optional.of(headerValue.trim());
        }

        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7).trim();
            if (!token.isBlank()) {
                return Optional.of(token);
            }
        }

        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }

        return Arrays.stream(cookies)
                .filter(cookie -> SESSION_COOKIE.equals(cookie.getName()))
                .map(Cookie::getValue)
                .filter(value -> value != null && !value.isBlank())
                .findFirst();
    }
}
