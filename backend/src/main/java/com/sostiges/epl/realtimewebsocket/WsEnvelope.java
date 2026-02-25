package com.sostiges.epl.realtimewebsocket;

import java.time.Instant;

public record WsEnvelope(String type, Object payload, Instant ts) {
}
