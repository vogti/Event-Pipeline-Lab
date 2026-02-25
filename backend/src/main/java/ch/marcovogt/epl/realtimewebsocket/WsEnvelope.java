package ch.marcovogt.epl.realtimewebsocket;

import java.time.Instant;

public record WsEnvelope(String type, Object payload, Instant ts) {
}
