package com.sostiges.epl.eventingestionnormalization;

import com.sostiges.epl.common.EventCategory;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "canonical_event")
public class CanonicalEvent {

    @Id
    private UUID id;

    @Column(name = "device_id", nullable = false, length = 128)
    private String deviceId;

    @Column(nullable = false, length = 256)
    private String topic;

    @Column(name = "event_type", nullable = false, length = 128)
    private String eventType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private EventCategory category;

    @Column(name = "payload_json", nullable = false, columnDefinition = "text")
    private String payloadJson;

    @Column(name = "device_ts")
    private Instant deviceTs;

    @Column(name = "ingest_ts", nullable = false)
    private Instant ingestTs;

    @Column(nullable = false)
    private boolean valid;

    @Column(name = "validation_errors", columnDefinition = "text")
    private String validationErrors;

    @Column(name = "is_internal", nullable = false)
    private boolean internal;

    @Column(name = "scenario_flags", nullable = false, columnDefinition = "text")
    private String scenarioFlags;

    @Column(name = "group_key", length = 128)
    private String groupKey;

    @Column(name = "sequence_no")
    private Long sequenceNo;

    public CanonicalEvent() {
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public void setDeviceId(String deviceId) {
        this.deviceId = deviceId;
    }

    public String getTopic() {
        return topic;
    }

    public void setTopic(String topic) {
        this.topic = topic;
    }

    public String getEventType() {
        return eventType;
    }

    public void setEventType(String eventType) {
        this.eventType = eventType;
    }

    public EventCategory getCategory() {
        return category;
    }

    public void setCategory(EventCategory category) {
        this.category = category;
    }

    public String getPayloadJson() {
        return payloadJson;
    }

    public void setPayloadJson(String payloadJson) {
        this.payloadJson = payloadJson;
    }

    public Instant getDeviceTs() {
        return deviceTs;
    }

    public void setDeviceTs(Instant deviceTs) {
        this.deviceTs = deviceTs;
    }

    public Instant getIngestTs() {
        return ingestTs;
    }

    public void setIngestTs(Instant ingestTs) {
        this.ingestTs = ingestTs;
    }

    public boolean isValid() {
        return valid;
    }

    public void setValid(boolean valid) {
        this.valid = valid;
    }

    public String getValidationErrors() {
        return validationErrors;
    }

    public void setValidationErrors(String validationErrors) {
        this.validationErrors = validationErrors;
    }

    public boolean isInternal() {
        return internal;
    }

    public void setInternal(boolean internal) {
        this.internal = internal;
    }

    public String getScenarioFlags() {
        return scenarioFlags;
    }

    public void setScenarioFlags(String scenarioFlags) {
        this.scenarioFlags = scenarioFlags;
    }

    public String getGroupKey() {
        return groupKey;
    }

    public void setGroupKey(String groupKey) {
        this.groupKey = groupKey;
    }

    public Long getSequenceNo() {
        return sequenceNo;
    }

    public void setSequenceNo(Long sequenceNo) {
        this.sequenceNo = sequenceNo;
    }
}
