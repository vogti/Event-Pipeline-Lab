package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class PipelineLogModeServiceTest {

    @Test
    void statusShouldReportDisabledWhenKafkaLogModeIsOff() {
        PipelineLogModeService service = new PipelineLogModeService(
                new ObjectMapper(),
                false,
                "kafka:9092",
                "epl.events.log",
                "test",
                200
        );

        PipelineLogModeStatusDto status = service.status();

        assertThat(status.enabled()).isFalse();
        assertThat(status.connected()).isFalse();
        assertThat(status.kafkaBacked()).isFalse();
        assertThat(status.topic()).isEqualTo("epl.events.log");
        assertThat(status.replayDefaultMaxRecords()).isEqualTo(200);
        assertThat(status.featureBadges()).containsExactly("realtime_pubsub", "no_offset_replay");
    }

    @Test
    void replayShouldRejectWhenKafkaLogModeIsOff() {
        PipelineLogModeService service = new PipelineLogModeService(
                new ObjectMapper(),
                false,
                "kafka:9092",
                "epl.events.log",
                "test",
                200
        );

        assertThatThrownBy(() -> service.replay("epld01", null, 100))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("not enabled");
    }
}

