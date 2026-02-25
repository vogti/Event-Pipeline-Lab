package com.sostiges.epl.eventingestionnormalization;

import com.fasterxml.jackson.databind.JsonNode;

public record NormalizedEvent(CanonicalEvent event, JsonNode payloadNode, Boolean explicitOnline) {
}
