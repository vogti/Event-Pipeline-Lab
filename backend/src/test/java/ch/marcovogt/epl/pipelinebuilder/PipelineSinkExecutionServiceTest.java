package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
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
    void sendEventSinkShouldPublishConfiguredPayloadWhenIncomingPayloadDisabled() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld02/command/led/green",
                                "payload", "{\"command\":\"on\"}",
                                "useIncomingPayload", false,
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-custom-payload-disabled-incoming",
                "epld01/event/button",
                "{\"state\":\"pressed\"}"
        );

        service.processProjectedEvent("task_intro", "epld01", sinkSection, inputEvent);

        verify(mqttCommandPublisher).publishCustom(
                "epld02/command/led/green",
                "{\"command\":\"on\"}",
                1,
                false
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
        assertThat(node.sinkType()).isEqualTo("SHOW_PAYLOAD");
        assertThat(node.lastPayloadPreview()).isEqualTo("abcdefghijklmnopqrstuvwxyz0123456789ABCD");
        assertThat(node.lastPayloadPreview()).hasSize(40);
    }

    @Test
    void sendEventSinkShouldAllowOwnScopeForLegacyPrefixedTopic() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld/epld01/command/led/green",
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-own-scope-legacy-prefix",
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

        verify(mqttCommandPublisher).publishCustom(
                "epld/epld01/command/led/green",
                "\"pressed\"",
                1,
                false
        );
    }

    @Test
    void sendEventSinkShouldAllowAdminScopeForLegacyPrefixedTopic() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld/epld99/command/led/orange",
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-admin-scope-legacy-prefix",
                "epld01/event/button/black",
                "\"pressed\""
        );

        service.processProjectedEvent(
                "task_intro",
                "epld01",
                sinkSection,
                inputEvent,
                StudentDeviceScope.ADMIN_DEVICE,
                "epld01",
                "epld99"
        );

        verify(mqttCommandPublisher).publishCustom(
                "epld/epld99/command/led/orange",
                "\"pressed\"",
                1,
                false
        );
    }

    @Test
    void sendEventSinkShouldAllowOwnAndAdminScopeForBothTargets() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(
                        new PipelineSinkNode(
                                "send-own",
                                "SEND_EVENT",
                                Map.of("topic", "epld01/command/led/green", "qos", 1, "retained", false)
                        ),
                        new PipelineSinkNode(
                                "send-admin",
                                "SEND_EVENT",
                                Map.of("topic", "epld99/command/led/orange", "qos", 1, "retained", false)
                        )
                ),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-own-admin-scope",
                "epld01/event/button/black",
                "\"pressed\""
        );

        service.processProjectedEvent(
                "task_intro",
                "epld01",
                sinkSection,
                inputEvent,
                StudentDeviceScope.OWN_AND_ADMIN_DEVICE,
                "epld01",
                "epld99"
        );

        verify(mqttCommandPublisher).publishCustom(eq("epld01/command/led/green"), eq("\"pressed\""), eq(1), eq(false));
        verify(mqttCommandPublisher).publishCustom(eq("epld99/command/led/orange"), eq("\"pressed\""), eq(1), eq(false));
    }

    @Test
    void sendEventSinkShouldFallbackInvalidQosToDefault() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld02/command/led/green",
                                "qos", 99,
                                "retained", "yes"
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-invalid-qos",
                "epld01/event/button/black",
                "\"pressed\""
        );

        service.processProjectedEvent("task_intro", "epld01", sinkSection, inputEvent);

        verify(mqttCommandPublisher).publishCustom(
                "epld02/command/led/green",
                "\"pressed\"",
                1,
                true
        );
    }

    @Test
    void sendEventSinkShouldAllowBroadcastTopicWhenOwnedByAdminPipeline() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "command/led/green",
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-admin-broadcast",
                "epld99/event/button/black",
                "\"on\""
        );

        service.processProjectedEvent(
                "task_intro",
                "epld99",
                sinkSection,
                inputEvent,
                StudentDeviceScope.OWN_DEVICE,
                "epld99",
                "epld99"
        );

        verify(mqttCommandPublisher).publishCustom(
                "command/led/green",
                "\"on\"",
                1,
                false
        );
    }

    @Test
    void sendEventSinkShouldStillBlockBroadcastTopicForStudentScope() {
        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "command/led/green",
                                "qos", 1,
                                "retained", false
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-student-broadcast",
                "epld01/event/button/black",
                "\"on\""
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
    void sendEventSinkShouldBlinkLedWhenEnabled() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld02/command/led/green",
                                "qos", 1,
                                "retained", false,
                                "ledBlinkEnabled", true,
                                "ledBlinkMs", 60
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-led-blink",
                "epld01/event/button/black",
                "\"pressed\""
        );

        service.processProjectedEvent("task_intro", "epld01", sinkSection, inputEvent);

        verify(mqttCommandPublisher, timeout(500)).publishCustom("epld02/command/led/green", "on", 1, false);
        verify(mqttCommandPublisher, timeout(1000)).publishCustom("epld02/command/led/green", "off", 1, false);
    }

    @Test
    void sendEventSinkShouldIgnoreBlinkForNonLedTopic() {
        when(mqttCommandPublisherProvider.getIfAvailable()).thenReturn(mqttCommandPublisher);

        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(new PipelineSinkNode(
                        "send-event",
                        "SEND_EVENT",
                        Map.of(
                                "topic", "epld02/event/custom",
                                "payload", "{\"forced\":true}",
                                "useIncomingPayload", false,
                                "qos", 1,
                                "retained", false,
                                "ledBlinkEnabled", true,
                                "ledBlinkMs", 60
                        )
                )),
                List.of(),
                "goal"
        );

        CanonicalEventDto inputEvent = event(
                "event-blink-non-led-topic",
                "epld01/event/button/black",
                "\"pressed\""
        );

        service.processProjectedEvent("task_intro", "epld01", sinkSection, inputEvent);

        verify(mqttCommandPublisher).publishCustom("epld02/event/custom", "{\"forced\":true}", 1, false);
        verify(mqttCommandPublisher, never()).publishCustom("epld02/event/custom", "on", 1, false);
        verify(mqttCommandPublisher, never()).publishCustom("epld02/event/custom", "off", 1, false);
    }

    @Test
    void resetSinkCounterShouldResetOnlyTargetSink() {
        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(
                        new PipelineSinkNode("show-payload", "SHOW_PAYLOAD", Map.of()),
                        new PipelineSinkNode("virtual-signal", "VIRTUAL_SIGNAL", Map.of())
                ),
                List.of(),
                "goal"
        );
        CanonicalEventDto inputEvent = event(
                "event-reset-target",
                "epld01/event/button/black",
                "\"pressed\""
        );

        PipelineSinkRuntimeSection beforeReset = service.processProjectedEvent("task_intro", "epld01", sinkSection, inputEvent);
        assertThat(nodeById(beforeReset, "show-payload").receivedCount()).isEqualTo(1L);
        assertThat(nodeById(beforeReset, "virtual-signal").receivedCount()).isEqualTo(1L);

        PipelineSinkRuntimeSection afterReset = service.resetSinkCounter("task_intro", "epld01", sinkSection, "show-payload");
        assertThat(nodeById(afterReset, "show-payload").receivedCount()).isEqualTo(0L);
        assertThat(nodeById(afterReset, "virtual-signal").receivedCount()).isEqualTo(1L);
    }

    @Test
    void eventFeedAndVirtualSignalShouldTrackReceivedEvents() {
        PipelineSinkSection sinkSection = new PipelineSinkSection(
                List.of(
                        new PipelineSinkNode("event-feed", "EVENT_FEED", Map.of()),
                        new PipelineSinkNode("virtual-signal", "VIRTUAL_SIGNAL", Map.of())
                ),
                List.of(),
                "goal"
        );
        CanonicalEventDto first = event(
                "event-runtime-track-1",
                "epld01/event/button/black",
                "\"pressed\""
        );
        CanonicalEventDto second = event(
                "event-runtime-track-2",
                "epld01/event/button/black",
                "\"released\""
        );

        service.processProjectedEvent("task_intro", "epld01", sinkSection, first);
        PipelineSinkRuntimeSection runtime = service.processProjectedEvent("task_intro", "epld01", sinkSection, second);

        assertThat(nodeById(runtime, "event-feed").receivedCount()).isEqualTo(2L);
        assertThat(nodeById(runtime, "virtual-signal").receivedCount()).isEqualTo(2L);
        assertThat(nodeById(runtime, "virtual-signal").lastPayloadPreview()).isEqualTo("\"released\"");
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

    private PipelineSinkRuntimeNodeDto nodeById(PipelineSinkRuntimeSection runtime, String sinkId) {
        return runtime.nodes().stream()
                .filter(node -> sinkId.equals(node.sinkId()))
                .findFirst()
                .orElseThrow();
    }
}
