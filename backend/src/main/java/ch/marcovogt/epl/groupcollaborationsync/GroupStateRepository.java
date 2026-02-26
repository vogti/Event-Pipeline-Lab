package ch.marcovogt.epl.groupcollaborationsync;

import org.springframework.data.jpa.repository.JpaRepository;

public interface GroupStateRepository extends JpaRepository<GroupState, String> {

    boolean existsByGroupKeyAndRevisionGreaterThan(String groupKey, long revision);
}
