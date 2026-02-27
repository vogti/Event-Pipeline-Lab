package ch.marcovogt.epl.taskscenarioengine;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "task_state")
public class TaskState {

    @Id
    private Short id;

    @Column(name = "active_task_id", nullable = false, length = 64)
    private String activeTaskId;

    @Column(name = "task_order_json", columnDefinition = "text")
    private String taskOrderJson;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 64)
    private String updatedBy;

    public Short getId() {
        return id;
    }

    public void setId(Short id) {
        this.id = id;
    }

    public String getActiveTaskId() {
        return activeTaskId;
    }

    public void setActiveTaskId(String activeTaskId) {
        this.activeTaskId = activeTaskId;
    }

    public String getTaskOrderJson() {
        return taskOrderJson;
    }

    public void setTaskOrderJson(String taskOrderJson) {
        this.taskOrderJson = taskOrderJson;
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
