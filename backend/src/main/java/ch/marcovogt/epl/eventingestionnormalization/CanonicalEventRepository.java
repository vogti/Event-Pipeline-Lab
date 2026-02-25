package ch.marcovogt.epl.eventingestionnormalization;

import ch.marcovogt.epl.common.EventCategory;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CanonicalEventRepository extends JpaRepository<CanonicalEvent, UUID> {

    @Query("""
            select e
            from CanonicalEvent e
            where (:deviceId is null or e.deviceId = :deviceId)
              and (:category is null or e.category = :category)
            order by e.ingestTs desc
            """)
    List<CanonicalEvent> findRecent(
            @Param("deviceId") String deviceId,
            @Param("category") EventCategory category,
            Pageable pageable
    );
}
