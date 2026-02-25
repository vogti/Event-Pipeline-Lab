package ch.marcovogt.epl.virtualdevice;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface VirtualDeviceStateRepository extends JpaRepository<VirtualDeviceState, String> {

    List<VirtualDeviceState> findAllByOrderByDeviceIdAsc();

    Optional<VirtualDeviceState> findByGroupKey(String groupKey);
}
