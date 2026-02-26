package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class PipelineScenarioOverlayCodecTest {

    @Test
    void normalizeShouldCanonicalizeKnownTokens() {
        List<String> normalized = PipelineScenarioOverlayCodec.normalize(
                List.of("duplicates:10", "delay:300ms", "drop:5%", "out-of-order:8%"),
                true
        );

        assertThat(normalized).containsExactly(
                "duplicates:10%",
                "delay:300ms",
                "drops:5%",
                "out_of_order:8%"
        );
    }

    @Test
    void normalizeShouldIgnoreUnknownTokensWhenNotStrict() {
        List<String> normalized = PipelineScenarioOverlayCodec.normalize(
                List.of("duplicates:9%", "noise:20%", "delay:350ms"),
                false
        );

        assertThat(normalized).containsExactly("duplicates:9%", "delay:350ms");
    }

    @Test
    void normalizeShouldRejectUnknownTokensWhenStrict() {
        assertThatThrownBy(() -> PipelineScenarioOverlayCodec.normalize(List.of("unknown:10"), true))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    ResponseStatusException ex = (ResponseStatusException) error;
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).contains("Unsupported scenario overlay");
                });
    }

    @Test
    void normalizeShouldRejectOutOfRangeValuesWhenStrict() {
        assertThatThrownBy(() -> PipelineScenarioOverlayCodec.normalize(List.of("delay:20000ms"), true))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    ResponseStatusException ex = (ResponseStatusException) error;
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(ex.getReason()).contains("Scenario value out of range");
                });
    }

    @Test
    void normalizeShouldClampOutOfRangeValuesWhenNotStrict() {
        List<String> normalized = PipelineScenarioOverlayCodec.normalize(
                List.of("duplicates:99%", "drop:99%"),
                false
        );

        assertThat(normalized).containsExactly("duplicates:99%", "drops:99%");
    }
}
