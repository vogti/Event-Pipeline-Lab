package ch.marcovogt.epl.eventfeedquery;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "feed_scenario_state")
public class FeedScenarioState {

    @Id
    private short id;

    @Column(name = "overlays_json", nullable = false, columnDefinition = "text")
    private String overlaysJson;

    @Column(name = "student_device_view_disturbed", nullable = false)
    private boolean studentDeviceViewDisturbed;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 64)
    private String updatedBy;

    public short getId() {
        return id;
    }

    public void setId(short id) {
        this.id = id;
    }

    public String getOverlaysJson() {
        return overlaysJson;
    }

    public void setOverlaysJson(String overlaysJson) {
        this.overlaysJson = overlaysJson;
    }

    public boolean isStudentDeviceViewDisturbed() {
        return studentDeviceViewDisturbed;
    }

    public void setStudentDeviceViewDisturbed(boolean studentDeviceViewDisturbed) {
        this.studentDeviceViewDisturbed = studentDeviceViewDisturbed;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getUpdatedBy() {
        return updatedBy;
    }

    public void setUpdatedBy(String updatedBy) {
        this.updatedBy = updatedBy;
    }
}
