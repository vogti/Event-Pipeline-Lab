package ch.marcovogt.epl.eventingestionnormalization;

import com.fasterxml.jackson.databind.JsonNode;

public record NormalizedEvent(CanonicalEvent event, JsonNode payloadNode, Boolean explicitOnline) {
}
