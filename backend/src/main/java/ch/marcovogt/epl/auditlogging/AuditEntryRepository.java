package ch.marcovogt.epl.auditlogging;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditEntryRepository extends JpaRepository<AuditEntry, Long> {
}
