package ch.marcovogt.epl.groupcollaborationsync;

import ch.marcovogt.epl.admin.AppSettingsDto;
import ch.marcovogt.epl.authsession.AuthMeResponse;
import ch.marcovogt.epl.authsession.PresenceUserDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import ch.marcovogt.epl.taskscenarioengine.TaskInfoDto;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceStateDto;
import java.util.List;

public record StudentBootstrapResponse(
        AuthMeResponse me,
        TaskInfoDto activeTask,
        TaskCapabilities capabilities,
        GroupConfigDto groupConfig,
        List<PresenceUserDto> groupPresence,
        List<CanonicalEventDto> recentFeed,
        VirtualDeviceStateDto virtualDevice,
        AppSettingsDto settings
) {
}
