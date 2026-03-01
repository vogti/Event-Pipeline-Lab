package ch.marcovogt.epl.externalsources;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "external_stream_source_state")
public class ExternalStreamSourceState {

    @Id
    @Column(name = "source_id", nullable = false, length = 64)
    private String sourceId;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "endpoint_url", nullable = false, columnDefinition = "text")
    private String endpointUrl;

    @Column(name = "counter_reset_at", nullable = false)
    private Instant counterResetAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 128)
    private String updatedBy;

    public ExternalStreamSourceState() {
    }

    public String getSourceId() {
        return sourceId;
    }

    public void setSourceId(String sourceId) {
        this.sourceId = sourceId;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getEndpointUrl() {
        return endpointUrl;
    }

    public void setEndpointUrl(String endpointUrl) {
        this.endpointUrl = endpointUrl;
    }

    public Instant getCounterResetAt() {
        return counterResetAt;
    }

    public void setCounterResetAt(Instant counterResetAt) {
        this.counterResetAt = counterResetAt;
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
