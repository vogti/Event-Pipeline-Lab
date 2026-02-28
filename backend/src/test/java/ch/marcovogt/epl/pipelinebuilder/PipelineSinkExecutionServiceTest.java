package ch.marcovogt.epl.pipelinebuilder;

import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.mqttgateway.MqttCommandPublisher;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;

@ExtendWith(MockitoExtension.class)
class PipelineSinkExecutionServiceTest {

    @Mock
    private ObjectProvider<MqttCommandPublisher> mqttCommandPublisherProvider;

    @Mock
    private MqttCommandPublisher mqttCommandPublisher;

    private PipelineSinkExecutionService service;

    @BeforeEach
    void setUp() {
        service = new PipelineSinkExecutionService(mqttCommandPublisherProvider, 1024);
    }

    @Test
    void sendEventSinkShouldPublishIncomingEventPayload() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld/epld02/cmd/led/green",
                                "payload", "{\"legacy\":true}",
                                "qos", 2,
                                "retained", true
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-1",
                "epld/epld01/event/button",
                "{\"state\":true}"
        );

        service.processProjectedEvent("task_intro", "epld01", sinkSection, inputEvent);

        verify(mqttCommandPublisher).publishCustom(
                "epld/epld02/cmd/led/green",
                "{\"state\":true}",
                2,
                true
        );
    }

    @Test
    void sendEventSinkShouldSkipPublishWhenTargetTopicEqualsInputTopic() {
        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld/epld01/event/button",
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-2",
                "epld/epld01/event/button",
                "{\"state\":false}"
        );

        service.processProjectedEvent("task_intro", "epld01", sinkSection, inputEvent);

        verify(mqttCommandPublisher, never()).publishCustom(anyString(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void sendEventSinkShouldResolveDevicePlaceholderInTopic() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "DEVICE/command/led/green",
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = new CanonicalEventDto(
                UUID.nameUUIDFromBytes("event-device-placeholder".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld07",
                "epld07/event/button",
                "button.black.press",
                EventCategory.BUTTON,
                "\"pressed\"",
                null,
                Instant.parse("2026-02-27T10:01:00Z"),
                true,
                null,
                false,
                "{}",
                "epld07",
                null
        );

        service.processProjectedEvent("task_intro", "epld07", sinkSection, inputEvent);

        verify(mqttCommandPublisher).publishCustom(
                "epld07/command/led/green",
                "\"pressed\"",
                1,
                false
        );
    }

    @Test
    void sendEventSinkShouldRespectStudentTargetScope() {
        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld02/command/led/green",
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-3",
                "epld01/event/button/black",
                "\"pressed\""
        );

        service.processProjectedEvent(
                "task_intro",
                "epld01",
                sinkSection,
                inputEvent,
                StudentDeviceScope.OWN_DEVICE,
                "epld01",
                "epld99"
        );

        verify(mqttCommandPublisher, never()).publishCustom(anyString(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void showPayloadSinkShouldStoreCappedPayloadPreview() {
        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "show-payload",
                        "SHOW_PAYLOAD",
                        Map.of()
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-4",
                "epld01/event/button/black",
                "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ"
        );

        PipelineSinkRuntimeSection runtime = service.processProjectedEvent(
                "task_intro",
                "epld01",
                sinkSection,
                inputEvent
        );

        PipelineSinkRuntimeNodeDto node = runtime.nodes().stream()
                .filter(candidate -> "show-payload".equals(candidate.sinkId()))
                .findFirst()
                .orElseThrow();
        org.assertj.core.api.Assertions.assertThat(node.sinkType()).isEqualTo("SHOW_PAYLOAD");
        org.assertj.core.api.Assertions.assertThat(node.lastPayloadPreview()).isEqualTo("abcdefghijklmnopqrstuvwxyz0123456789ABCD");
        org.assertj.core.api.Assertions.assertThat(node.lastPayloadPreview()).hasSize(40);
    }

    private CanonicalEventDto event(String idSeed, String topic, String payloadJson) {
        return new CanonicalEventDto(
                UUID.nameUUIDFromBytes(idSeed.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld01",
                topic,
                "button.black.press",
                EventCategory.BUTTON,
                payloadJson,
                null,
                Instant.parse("2026-02-27T10:00:00Z"),
                true,
                null,
                false,
                "{}",
                "epld01",
                null
        );
    }
}
