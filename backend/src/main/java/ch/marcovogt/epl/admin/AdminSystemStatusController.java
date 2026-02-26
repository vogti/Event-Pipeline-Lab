package ch.marcovogt.epl.admin;

import ch.marcovogt.epl.auditlogging.AdminAuditLogger;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.RequestAuth;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/admin/system-status")
public class AdminSystemStatusController {

    private static final DateTimeFormatter EXPORT_TS_FORMAT =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);

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
    public ResponseEntity<byte[]> exportData(
            HttpServletRequest request,
            @Valid @RequestBody SystemDataExportRequest body
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        byte[] archiveBytes = systemDataTransferService.exportDataArchive(body.parts());
        String fileName = "epl-export-" + EXPORT_TS_FORMAT.format(Instant.now()) + ".zip";
        adminAuditLogger.logAction(
                "admin.system.export",
                principal.username(),
                Map.of(
                        "parts", body.parts().stream().map(Enum::name).sorted().toList(),
                        "schemaVersion", systemDataTransferService.schemaVersion()
                )
        );
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .contentType(MediaType.parseMediaType("application/zip"))
                .body(archiveBytes);
    }

    @PostMapping(value = "/import/verify", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public SystemDataImportVerifyResponse verifyImport(
            HttpServletRequest request,
            @RequestPart("file") MultipartFile file
    ) {
        requestAuth.requireRole(request, AppRole.ADMIN);
        return systemDataTransferService.verifyImportArchive(readFileBytes(file));
    }

    @PostMapping(value = "/import/apply", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public SystemDataImportApplyResponse applyImport(
            HttpServletRequest request,
            @RequestPart("file") MultipartFile file,
            @RequestParam("selectedParts") Set<SystemDataPart> selectedParts
    ) {
        SessionPrincipal principal = requestAuth.requireRole(request, AppRole.ADMIN);
        SystemDataImportApplyResponse imported = systemDataTransferService.applyImportArchive(
                readFileBytes(file),
                selectedParts
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
                        "parts", selectedParts.stream().map(Enum::name).sorted().toList(),
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

    private byte[] readFileBytes(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "file is required");
        }
        try {
            return file.getBytes();
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Failed to read uploaded file", ex);
        }
    }
}
