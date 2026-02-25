package ch.marcovogt.epl.authsession;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class AuthExceptions {

    private AuthExceptions() {
    }

    public static ResponseStatusException invalidCredentials() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
    }

    public static ResponseStatusException invalidSession() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired session");
    }

    public static ResponseStatusException forbidden() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
    }
}
