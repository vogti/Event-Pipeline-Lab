package ch.marcovogt.epl.mqttgateway;

import ch.marcovogt.epl.eventingestionnormalization.EventIngestionService;
import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.eclipse.paho.client.mqttv3.IMqttActionListener;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttAsyncClient;
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

@Component
public class MqttGatewayClient implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(MqttGatewayClient.class);

    private final MqttGatewayProperties properties;
    private final EventIngestionService eventIngestionService;
    private final AdminWebSocketBroadcaster webSocketBroadcaster;
    private final PublishSourceContext publishSourceContext;
    private final PublishedEventSourceTracker publishedEventSourceTracker;

    private final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean reconnectScheduled = new AtomicBoolean(false);

    private volatile boolean running;
    private volatile MqttAsyncClient mqttClient;
    private volatile String resolvedClientId;

    public MqttGatewayClient(
            MqttGatewayProperties properties,
            EventIngestionService eventIngestionService,
            AdminWebSocketBroadcaster webSocketBroadcaster,
            PublishSourceContext publishSourceContext,
            PublishedEventSourceTracker publishedEventSourceTracker
    ) {
        this.properties = properties;
        this.eventIngestionService = eventIngestionService;
        this.webSocketBroadcaster = webSocketBroadcaster;
        this.publishSourceContext = publishSourceContext;
        this.publishedEventSourceTracker = publishedEventSourceTracker;
    }

    @Override
    public synchronized void start() {
        if (running) {
            return;
        }
        running = true;
        connectAsync();
    }

    @Override
    public synchronized void stop() {
        running = false;

        MqttAsyncClient client = mqttClient;
        if (client != null) {
            try {
                if (client.isConnected()) {
                    client.disconnect().waitForCompletion(3000);
                }
                client.close();
            } catch (MqttException ex) {
                log.warn("Error while closing MQTT client: {}", ex.getMessage());
            }
        }

        reconnectExecutor.shutdownNow();
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return Integer.MIN_VALUE;
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public void stop(Runnable callback) {
        stop();
        callback.run();
    }

    public void publish(String topic, String payload, int qos, boolean retained) {
        MqttAsyncClient client = mqttClient;
        if (client == null || !client.isConnected()) {
            throw new IllegalStateException("MQTT client is not connected");
        }

        try {
            String source = publishSourceContext.currentSource();
            if (source != null && !source.isBlank()) {
                publishedEventSourceTracker.register(topic, payload, source);
            }
            client.publish(topic, payload.getBytes(StandardCharsets.UTF_8), qos, retained);
            log.info("MQTT publish topic={} qos={} retained={}", topic, qos, retained);
        } catch (MqttException ex) {
            throw new IllegalStateException("Failed to publish MQTT command", ex);
        }
    }

    private void connectAsync() {
        if (!running) {
            return;
        }

        try {
            initializeClientIfNeeded();
            MqttAsyncClient client = mqttClient;
            if (client == null || client.isConnected()) {
                return;
            }

            MqttConnectOptions options = new MqttConnectOptions();
            options.setAutomaticReconnect(false);
            options.setCleanSession(properties.isCleanSession());
            if (hasText(properties.getUsername())) {
                options.setUserName(properties.getUsername());
            }
            if (hasText(properties.getPassword())) {
                options.setPassword(properties.getPassword().toCharArray());
            }

            client.connect(options, null, new IMqttActionListener() {
                @Override
                public void onSuccess(org.eclipse.paho.client.mqttv3.IMqttToken asyncActionToken) {
                    reconnectScheduled.set(false);
                    log.info("Connected to MQTT broker={} clientId={}", properties.getBrokerUri(), resolvedClientId);
                }

                @Override
                public void onFailure(org.eclipse.paho.client.mqttv3.IMqttToken asyncActionToken, Throwable exception) {
                    log.error("MQTT connect failed: {}", exception.getMessage());
                    webSocketBroadcaster.broadcastError("MQTT connect failed: " + exception.getMessage());
                    scheduleReconnect();
                }
            });
        } catch (MqttException ex) {
            log.error("MQTT initialization failed: {}", ex.getMessage());
            scheduleReconnect();
        }
    }

    private void initializeClientIfNeeded() throws MqttException {
        if (mqttClient != null) {
            return;
        }

        resolvedClientId = properties.resolveClientId();
        mqttClient = new MqttAsyncClient(properties.getBrokerUri(), resolvedClientId, new MemoryPersistence());
        mqttClient.setCallback(new MqttCallbackExtended() {
            @Override
            public void connectComplete(boolean reconnect, String serverURI) {
                log.info("MQTT connectComplete reconnect={} uri={}", reconnect, serverURI);
                subscribeAll();
            }

            @Override
            public void connectionLost(Throwable cause) {
                String reason = cause == null ? "unknown" : cause.getMessage();
                log.warn("MQTT connection lost: {}", reason);
                webSocketBroadcaster.broadcastError("MQTT connection lost: " + reason);
                scheduleReconnect();
            }

            @Override
            public void messageArrived(String topic, MqttMessage message) {
                try {
                    eventIngestionService.ingest(topic, message.getPayload());
                } catch (Exception ex) {
                    log.error("MQTT message processing failed topic={} reason={}", topic, ex.getMessage(), ex);
                    webSocketBroadcaster.broadcastError("MQTT message processing failed: " + topic);
                }
            }

            @Override
            public void deliveryComplete(IMqttDeliveryToken token) {
                // backend command publishing acknowledgement is not required in Phase 1
            }
        });
    }

    private void subscribeAll() {
        MqttAsyncClient client = mqttClient;
        if (client == null || !client.isConnected()) {
            return;
        }

        for (String topicFilter : properties.getTopicFilters()) {
            try {
                client.subscribe(topicFilter, properties.getQos(), null, new IMqttActionListener() {
                    @Override
                    public void onSuccess(org.eclipse.paho.client.mqttv3.IMqttToken asyncActionToken) {
                        log.info("MQTT subscribed topicFilter={} qos={}", topicFilter, properties.getQos());
                    }

                    @Override
                    public void onFailure(org.eclipse.paho.client.mqttv3.IMqttToken asyncActionToken, Throwable exception) {
                        log.error("MQTT subscribe failed topicFilter={} reason={}", topicFilter, exception.getMessage());
                    }
                });
            } catch (MqttException ex) {
                log.error("MQTT subscribe exception topicFilter={} reason={}", topicFilter, ex.getMessage());
            }
        }
    }

    private void scheduleReconnect() {
        if (!running || !reconnectScheduled.compareAndSet(false, true)) {
            return;
        }

        reconnectExecutor.schedule(() -> {
            reconnectScheduled.set(false);
            connectAsync();
        }, properties.getReconnectDelayMs(), TimeUnit.MILLISECONDS);
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
