package ch.marcovogt.epl.pipelinebuilder;

import java.io.Serial;
import java.io.Serializable;
import java.util.Objects;

public class PipelineStateId implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    private String taskId;
    private PipelineOwnerType ownerType;
    private String ownerKey;

    public PipelineStateId() {
    }

    public PipelineStateId(String taskId, PipelineOwnerType ownerType, String ownerKey) {
        this.taskId = taskId;
        this.ownerType = ownerType;
        this.ownerKey = ownerKey;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof PipelineStateId that)) {
            return false;
        }
        return Objects.equals(taskId, that.taskId)
                && ownerType == that.ownerType
                && Objects.equals(ownerKey, that.ownerKey);
    }

    @Override
    public int hashCode() {
        return Objects.hash(taskId, ownerType, ownerKey);
    }
}
