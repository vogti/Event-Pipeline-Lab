package com.sostiges.epl.deviceregistryhealth;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeviceStatusRepository extends JpaRepository<DeviceStatus, String> {

    List<DeviceStatus> findAllByOrderByDeviceIdAsc();

    List<DeviceStatus> findByOnlineTrueAndLastSeenBefore(Instant cutoff);
}
