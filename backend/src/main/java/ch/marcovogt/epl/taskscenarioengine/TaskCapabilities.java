package ch.marcovogt.epl.taskscenarioengine;

import java.util.List;

public record TaskCapabilities(
        boolean canViewRoomEvents,
        boolean canSendDeviceCommands,
        boolean showDevicePanel,
        boolean studentSendEventEnabled,
        boolean canFilterByTopic,
        boolean showInternalEventsToggle,
        List<String> allowedConfigOptions,
        List<String> studentCommandWhitelist,
        StudentDeviceScope studentEventVisibilityScope,
        StudentDeviceScope studentCommandTargetScope
) {
}
