// 宫格节点:按预设生成一张宫格大图,再自动切分成 rows×columns 张图片节点铺在右侧。
import { buildImageNodeOps, definePlugin, getUpstreamImages, readImageSize, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";
import { buildGridPrompt, GRID_PRESET_IDS, GRID_PRESETS, tileRects } from "./logic";
import type { GridPresetId } from "./logic";
import { sliceImage } from "./slice";

const SIZE_OPTIONS = [
    { value: "", label: "默认尺寸" },
    { value: "auto", label: "自动" },
    { value: "1024x1024", label: "1024×1024" },
    { value: "2048x2048", label: "2048×2048" },
    { value: "1536x1024", label: "1536×1024(横)" },
    { value: "1024x1536", label: "1024×1536(竖)" },
];

// 铺图布局:大图在节点右侧 80px,切分图在大图右侧 80px
const OFFSET = 80;
const BIG_WIDTH = 360;
const TILE_WIDTH = 160;
const TILE_GAP = 20;

function GridShotsContent({ ctx }: CanvasNodeContentProps) {
    const metadata = ctx.node.metadata || {};
    const presetId = (GRID_PRESETS[metadata.gridPreset as GridPresetId] ? metadata.gridPreset : "multi-angle-9") as GridPresetId;
    const note = (metadata.gridNote as string) || "";
    const models = ctx.ai.listModels("image");
    const model = (metadata.gridModel as string) || ctx.ai.defaultModel("image");
    const size = (metadata.gridSize as string) || "";
    const preset = GRID_PRESETS[presetId];
    const references = getUpstreamImages(ctx);

    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    const run = async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setError("");
        try {
            setStatus("生成宫格大图中…");
            const result = await ctx.ai.generateImage(buildGridPrompt(presetId, note), {
                count: 1,
                signal: controller.signal,
                ...(references.length ? { references } : {}),
                ...(model ? { model } : {}),
                ...(size ? { size } : {}),
            });
            const big = result.images[0];
            if (!big) throw new Error("没有返回图片");
            setStatus("切分中…");
            const bigSize = await readImageSize(big);
            const tiles = await sliceImage(big, tileRects(bigSize.width, bigSize.height, preset.rows, preset.columns));
            if (controller.signal.aborted) {
                setStatus("已取消");
                return;
            }

            const stamp = Date.now().toString(36);
            const origin = { x: ctx.node.position.x + ctx.node.width + OFFSET, y: ctx.node.position.y };
            const bigOps = buildImageNodeOps(ctx.node.id, [{ id: `grid-${ctx.node.id}-${stamp}-big`, title: preset.label, dataUrl: big, width: bigSize.width, height: bigSize.height }], origin, { cellWidth: BIG_WIDTH });
            const tileItems = tiles.map((tile, index) => ({ id: `grid-${ctx.node.id}-${stamp}-${index + 1}`, title: `宫格 ${index + 1}`, ...tile }));
            const tileOps = buildImageNodeOps(ctx.node.id, tileItems, { x: origin.x + BIG_WIDTH + OFFSET, y: origin.y }, { columns: preset.columns, gap: TILE_GAP, cellWidth: TILE_WIDTH });
            ctx.applyOps([...bigOps, ...tileOps]);
            setStatus(`已生成 1 张大图 + ${tiles.length} 张切分图`);
        } catch (err) {
            if (controller.signal.aborted) {
                setStatus("已取消");
            } else {
                setStatus("");
                setError(err instanceof Error ? err.message : String(err));
            }
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const cancel = () => abortRef.current?.abort();

    const theme = ctx.theme;
    const field = { width: "100%", boxSizing: "border-box", padding: "4px 8px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.node.panel, color: theme.node.text, fontSize: 12 } as const;
    const btn = { padding: "6px 12px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.toolbar.activeBg, color: theme.toolbar.activeText, cursor: "pointer", fontSize: 12 } as const;
    const label = { fontSize: 12, color: theme.node.muted } as const;

    return (
        // 空白区域可拖动节点，表单控件保持可交互。
        <div data-canvas-no-zoom onMouseDown={(e) => {
            if (e.target instanceof Element && e.target.closest("input, textarea, select, button")) e.stopPropagation();
        }} onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, boxSizing: "border-box", color: theme.node.text, overflow: "auto" }}>
            <label style={label}>
                预设
                <select value={presetId} disabled={running} onChange={(e) => ctx.updateMetadata({ gridPreset: e.target.value })} style={{ ...field, marginTop: 4 }}>
                    {GRID_PRESET_IDS.map((id) => (
                        <option key={id} value={id}>
                            {GRID_PRESETS[id].label}({GRID_PRESETS[id].rows}×{GRID_PRESETS[id].columns})
                        </option>
                    ))}
                </select>
            </label>
            <textarea value={note} disabled={running} placeholder="补充描述(可选),拼在预设提示词后" onChange={(e) => ctx.updateMetadata({ gridNote: e.target.value })} style={{ ...field, flex: 1, minHeight: 48, resize: "none", lineHeight: 1.5 }} />
            <div style={{ display: "flex", gap: 6 }}>
                <select value={model} disabled={running} onChange={(e) => ctx.updateMetadata({ gridModel: e.target.value })} style={field}>
                    {models.length ? (
                        models.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))
                    ) : (
                        <option value="">默认模型</option>
                    )}
                </select>
                <select value={size} disabled={running} onChange={(e) => ctx.updateMetadata({ gridSize: e.target.value })} style={field}>
                    {SIZE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {running ? (
                    <button type="button" style={btn} onClick={cancel}>
                        取消
                    </button>
                ) : (
                    <button type="button" style={btn} onClick={run}>
                        生成宫格
                    </button>
                )}
                <span style={label}>{references.length ? `参考图 ${references.length} 张` : "无参考图"}</span>
            </div>
            {status ? <div style={label}>{status}</div> : null}
            {error ? <div style={{ fontSize: 12, color: theme.node.text, whiteSpace: "pre-wrap" }}>生成失败:{error}</div> : null}
        </div>
    );
}

export default definePlugin({
    id: "grid-shots",
    name: "宫格节点",
    version: "1.0.0",
    description: "多机位九宫格、剧情四宫格、三视图并自动切分",
    nodes: [
        {
            type: "grid-shots:node",
            title: "宫格",
            icon: "🔲",
            description: "生成宫格大图并自动切分成多张图片节点",
            defaultSize: { width: 360, height: 300 },
            defaultMetadata: { gridPreset: "multi-angle-9", gridNote: "" },
            minimapColor: "#0ea5e9",
            hidePanel: true,
            Content: GridShotsContent,
        },
    ],
});
