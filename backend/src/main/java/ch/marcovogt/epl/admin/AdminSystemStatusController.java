package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin/system-status")
public class AdminSystemStatusController {

    private final RequestAuth requestAuth;
    private final AdminSystemStatusService adminSystemStatusService;
    private final SystemDataTransferService systemDataTransferService;
    private final AdminAuditLogger adminAuditLogger;

    public AdminSystemStatusController(
            RequestAuth requestAuth,
            AdminSystemStatusService adminSystemStatusService,
            SystemDataTransferService systemDataTransferService,
            AdminAuditLogger adminAuditLogger
    ) {
        this.requestAuth = requestAuth;
        this.adminSystemStatusService = adminSystemStatusService;
        this.systemDataTransferService = systemDataTransferService;
        this.adminAuditLogger = adminAuditLogger;
    }

    @GetMapping
    public AdminSystemStatusResponse getStatus(HttpServletRequest request) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return adminSystemStatusService.snapshot();
    }

    @PostMapping("/export")
    public SystemDataTransferDocument exportData(
            HttpServletRequest request,
            @Valid @RequestBody SystemDataExportRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        SystemDataTransferDocument document = systemDataTransferService.exportData(body.parts());
        adminAuditLogger.logAction(
                "admin.system.export",
                principal.username(),
                Map.of(
                        "parts", body.parts().stream().map(Enum::name).sorted().toList(),
                        "schemaVersion", document.schemaVersion()
                )
        );
        return document;
    }

    @PostMapping("/import/verify")
    public SystemDataImportVerifyResponse verifyImport(
            HttpServletRequest request,
            @Valid @RequestBody SystemDataImportVerifyRequest body
    ) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return systemDataTransferService.verifyImportDocument(body.document());
    }

    @PostMapping("/import/apply")
    public SystemDataImportApplyResponse applyImport(
            HttpServletRequest request,
            @Valid @RequestBody SystemDataImportApplyRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        SystemDataImportApplyResponse imported = systemDataTransferService.applyImport(
                body.document(),
                body.selectedParts()
        );

        Map<String, Long> importedCounts = imported.importedParts()
                .stream()
                .collect(Collectors.toMap(
                        entry -> entry.part().name(),
                        SystemDataImportPartInfo::rowCount,
                        (left, right) -> right,
                        LinkedHashMap::new
                ));

        adminAuditLogger.logAction(
                "admin.system.import.apply",
                principal.username(),
                Map.of(
                        "parts", body.selectedParts().stream().map(Enum::name).sorted().toList(),
                        "importedRowCounts", importedCounts
                )
        );
        return imported;
    }

    @PostMapping("/events/reset")
    public ResetEventsResponse resetEvents(
            HttpServletRequest request,
            @Valid @RequestBody ResetEventsRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        if (!Boolean.TRUE.equals(body.confirm())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "confirm must be true");
        }

        ResetEventsResponse reset = adminSystemStatusService.resetEvents();
        adminAuditLogger.logAction(
                "admin.system.events.reset",
                principal.username(),
                Map.of("deletedEvents", reset.deletedEvents())
        );
        return reset;
    }
}
