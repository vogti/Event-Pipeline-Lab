package ch.marcovogt.epl.groupcollaborationsync;

import ch.marcovogt.epl.authsession.PresenceUserDto;
import java.util.List;

public record GroupOverviewDto(
        String groupKey,
        int onlineCount,
        List<PresenceUserDto> presence,
        GroupConfigDto config
) {
}
