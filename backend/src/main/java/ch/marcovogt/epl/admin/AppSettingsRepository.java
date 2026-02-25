package ch.marcovogt.epl.admin;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AppSettingsRepository extends JpaRepository<AppSettings, Short> {
}
