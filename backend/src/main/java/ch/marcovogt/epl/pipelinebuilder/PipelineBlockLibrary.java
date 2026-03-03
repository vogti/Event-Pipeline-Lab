package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;
import java.util.Set;

public final class PipelineBlockLibrary {

    public static final String NONE = "NONE";

    private static final List<String> ALL_BLOCKS = List.of(
            NONE,
            "FILTER_DEVICE",
            "FILTER_TOPIC",
            "FILTER_PAYLOAD",
            "CONDITIONAL_PAYLOAD",
            "EXTRACT_VALUE",
            "TRANSFORM_PAYLOAD",
            "FILTER_RATE_LIMIT",
            "DEDUP",
            "WINDOW_AGGREGATE",
            "MICRO_BATCH"
    );

    private static final Set<String> ALL_BLOCK_SET = Set.copyOf(ALL_BLOCKS);

    private PipelineBlockLibrary() {
    }

    public static List<String> allBlocks() {
        return ALL_BLOCKS;
    }

    public static boolean isKnown(String blockType) {
        return blockType != null && ALL_BLOCK_SET.contains(blockType);
    }
}
