package ch.marcovogt.epl.externalsources;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExternalStreamSourceStateRepository extends JpaRepository<ExternalStreamSourceState, String> {

    List<ExternalStreamSourceState> findAllByOrderBySourceIdAsc();
}
