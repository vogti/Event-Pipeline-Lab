package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.AuthService;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.groupcollaborationsync.GroupConfigDto;
import ch.marcovogt.epl.groupcollaborationsync.GroupOverviewDto;
import ch.marcovogt.epl.groupcollaborationsync.GroupStateService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/groups")
public class AdminGroupController {

    private final RequestAuth requestAuth;
    private final AuthService authService;
    private final GroupStateService groupStateService;

    public AdminGroupController(
            RequestAuth requestAuth,
            AuthService authService,
            GroupStateService groupStateService
    ) {
        this.requestAuth = requestAuth;
        this.authService = authService;
        this.groupStateService = groupStateService;
    }

    @GetMapping
    public List<GroupOverviewDto> listGroups(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);

        return authService.listStudentGroupKeys().stream()
                .map(groupKey -> {
                    GroupConfigDto config = groupStateService.getOrCreate(groupKey);
                    var presence = authService.listGroupPresence(groupKey);
                    return new GroupOverviewDto(groupKey, presence.size(), presence, config);
                })
                .toList();
    }
}
