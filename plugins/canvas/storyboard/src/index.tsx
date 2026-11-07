// 分镜脚本节点:剧本 → 文本模型拆成可编辑分镜表 → 勾选行批量出图、批量出视频。
// 剧本优先取节点内输入,为空时取上游文本;出图参考上游图片,出视频以该镜分镜图为首帧。
import { buildImageNodeOps, definePlugin, getUpstreamImages, getUpstreamText, readImageSize, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasAgentOp, CanvasNodeContentProps, ImageNodeItem } from "@infinite-canvas/plugin-sdk";
import { buildShotPrompt, createRow, parseStoryboard, renumberRows, runPool, SPLIT_SYSTEM_PROMPT, toSeconds } from "./logic";
import type { StoryboardRow } from "./logic";

const CONCURRENCY = 3;
const NODE_GAP = 80;
const VIDEO_GAP = 40;

type RowState = "image" | "video" | "error";
type Busy = "split" | "image" | "video" | null;

function StoryboardContent({ ctx }: CanvasNodeContentProps) {
    const theme = ctx.theme;
    const script = (ctx.node.metadata?.script as string | undefined) || "";
    const rows = (ctx.node.metadata?.rows as StoryboardRow[] | undefined) || [];
    const [checked, setChecked] = useState<string[]>([]);
    const [busy, setBusy] = useState<Busy>(null);
    const [message, setMessage] = useState("");
    const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
    // 异步生成期间表格可能被编辑,写回时以最新行数据为准
    const rowsRef = useRef(rows);
    rowsRef.current = rows;

    const upstreamText = getUpstreamText(ctx);
    const checkedRows = rows.filter((row) => checked.includes(row.id));
    const videoRows = checkedRows.filter((row) => row.imageNodeId && ctx.getNode(row.imageNodeId)?.metadata?.content);

    const saveRows = (next: StoryboardRow[]) => {
        const renumbered = renumberRows(next);
        rowsRef.current = renumbered;
        ctx.updateMetadata({ rows: renumbered });
    };
    const patchRow = (id: string, patch: Partial<StoryboardRow>) => saveRows(rowsRef.current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    const setRowState = (id: string, state: RowState | null) =>
        setRowStates((prev) => {
            const next = { ...prev };
            if (state) next[id] = state;
            else delete next[id];
            return next;
        });

    // 拆分镜:文本模型只输出 JSON 数组,解析失败给出统一提示
    const split = async () => {
        const source = script.trim() || upstreamText.trim();
        if (!source) {
            setMessage("请先输入剧本，或连入上游文本节点");
            return;
        }
        setBusy("split");
        setMessage("正在拆分镜…");
        try {
            const images = getUpstreamImages(ctx);
            const { text } = await ctx.ai.generateText(`剧本：\n${source}`, { system: SPLIT_SYSTEM_PROMPT, ...(images.length ? { images } : {}) });
            let parsed: StoryboardRow[];
            try {
                parsed = parseStoryboard(text);
            } catch {
                setMessage("分镜解析失败，请重试");
                return;
            }
            saveRows(parsed);
            setChecked([]);
            setRowStates({});
            setMessage(`已拆出 ${parsed.length} 个镜头`);
        } catch (error) {
            setMessage(errorText(error, "拆分镜失败"));
        } finally {
            setBusy(null);
        }
    };

    // 批量出图:勾选行逐条生成(并发 3),参考上游图片,铺成图片节点「镜 N」
    const generateImages = async () => {
        const targets = [...checkedRows].sort((a, b) => a.shot - b.shot);
        if (!targets.length) return;
        const references = getUpstreamImages(ctx);
        const results = new Map<string, ImageNodeItem>();
        let failed = 0;
        setBusy("image");
        setMessage(`正在出图 0/${targets.length}…`);
        await runPool(targets, CONCURRENCY, async (row) => {
            setRowState(row.id, "image");
            try {
                const { images } = await ctx.ai.generateImage(buildShotPrompt(row), references.length ? { references } : undefined);
                const dataUrl = images[0];
                if (!dataUrl) throw new Error("未返回图片");
                const size = await readImageSize(dataUrl).catch(() => ({ width: 1024, height: 1024 }));
                results.set(row.id, { id: `${ctx.node.id}-shot-${row.id}-${Date.now().toString(36)}`, title: `镜 ${row.shot}`, dataUrl, ...size });
                setRowState(row.id, null);
            } catch {
                failed += 1;
                setRowState(row.id, "error");
            }
            setMessage(`正在出图 ${results.size + failed}/${targets.length}…`);
        });
        const done = targets.filter((row) => results.has(row.id));
        if (done.length) {
            const items = done.map((row) => results.get(row.id) as ImageNodeItem);
            // 竖排一列,右侧留给对应的视频节点
            const origin = { x: ctx.node.position.x + ctx.node.width + NODE_GAP, y: ctx.node.position.y };
            ctx.applyOps(buildImageNodeOps(ctx.node.id, items, origin, { columns: 1 }));
            const idByRow = new Map(done.map((row) => [row.id, (results.get(row.id) as ImageNodeItem).id]));
            saveRows(rowsRef.current.map((row) => (idByRow.has(row.id) ? { ...row, imageNodeId: idByRow.get(row.id) } : row)));
        }
        setMessage(failed ? `出图完成 ${done.length} 张，失败 ${failed} 张` : `出图完成 ${done.length} 张`);
        setBusy(null);
    };

    // 批量出视频:以该镜分镜图为首帧参考,在图片节点右侧新增视频节点并连线
    const generateVideos = async () => {
        const targets = [...videoRows].sort((a, b) => a.shot - b.shot);
        if (!targets.length) return;
        let done = 0;
        let failed = 0;
        setBusy("video");
        setMessage(`正在出视频 0/${targets.length}…`);
        await runPool(targets, CONCURRENCY, async (row) => {
            const imageNode = row.imageNodeId ? ctx.getNode(row.imageNodeId) : null;
            const image = imageNode?.metadata?.content;
            if (!imageNode || !image) return;
            setRowState(row.id, "video");
            try {
                const video = await ctx.ai.generateVideo(buildShotPrompt(row), { references: [image], seconds: String(toSeconds(row.seconds)) });
                const width = imageNode.width;
                const height = video.width && video.height ? Math.round((width * video.height) / video.width) : imageNode.height;
                const videoId = `${imageNode.id}-video-${Date.now().toString(36)}`;
                const ops: CanvasAgentOp[] = [
                    {
                        type: "add_node",
                        id: videoId,
                        nodeType: "video",
                        title: `镜 ${row.shot} 视频`,
                        position: { x: imageNode.position.x + imageNode.width + VIDEO_GAP, y: imageNode.position.y },
                        width,
                        height,
                        metadata: { content: video.url, status: "success", mimeType: video.mimeType, naturalWidth: video.width, naturalHeight: video.height, durationMs: video.durationMs },
                    },
                    { type: "connect_nodes", fromNodeId: imageNode.id, toNodeId: videoId },
                ];
                ctx.applyOps(ops);
                done += 1;
                setRowState(row.id, null);
            } catch {
                failed += 1;
                setRowState(row.id, "error");
            }
            setMessage(`正在出视频 ${done + failed}/${targets.length}…`);
        });
        setMessage(failed ? `出视频完成 ${done} 个，失败 ${failed} 个` : `出视频完成 ${done} 个`);
        setBusy(null);
    };

    const toggle = (id: string) => setChecked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    const allChecked = rows.length > 0 && rows.every((row) => checked.includes(row.id));
    const removeRow = (id: string) => {
        saveRows(rowsRef.current.filter((row) => row.id !== id));
        setChecked((prev) => prev.filter((item) => item !== id));
    };

    const btn = (disabled: boolean) =>
        ({ padding: "4px 10px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.toolbar.panel, color: disabled ? theme.node.faint : theme.node.text, cursor: disabled ? "not-allowed" : "pointer", fontSize: 12, whiteSpace: "nowrap" }) as const;
    const cellInput = { width: "100%", boxSizing: "border-box", border: `1px solid ${theme.node.stroke}`, borderRadius: 6, background: "transparent", color: theme.node.text, fontSize: 12, padding: "3px 6px", outline: "none", fontFamily: "inherit" } as const;
    const th = { textAlign: "left", fontWeight: 500, color: theme.node.muted, padding: "4px 6px", borderBottom: `1px solid ${theme.node.stroke}`, whiteSpace: "nowrap" } as const;
    const td = { padding: "4px 6px", borderBottom: `1px solid ${theme.node.stroke}`, verticalAlign: "top" } as const;

    const stateLabel = (row: StoryboardRow) => {
        const state = rowStates[row.id];
        if (state === "image") return "出图中…";
        if (state === "video") return "出视频中…";
        if (state === "error") return "失败";
        return row.imageNodeId && ctx.getNode(row.imageNodeId) ? "已出图" : "";
    };

    return (
        // 空白区域可拖动节点，表单控件保持可交互。
        <div data-canvas-no-zoom onMouseDown={(e) => {
            if (e.target instanceof Element && e.target.closest("input, textarea, select, button")) e.stopPropagation();
        }} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, boxSizing: "border-box", color: theme.node.text, fontSize: 12 }}>
            <textarea
                value={script}
                placeholder={upstreamText ? "留空则使用上游文本作为剧本" : "输入剧本，或连入上游文本节点"}
                onChange={(e) => ctx.updateMetadata({ script: e.target.value })}
                onWheel={(e) => e.stopPropagation()}
                style={{ height: 72, flexShrink: 0, resize: "none", border: `1px solid ${theme.node.stroke}`, borderRadius: 8, padding: 8, outline: "none", background: "transparent", color: theme.node.text, fontSize: 13, lineHeight: 1.5, fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" style={btn(busy !== null)} disabled={busy !== null} onClick={split}>
                    {busy === "split" ? "拆分中…" : "拆分镜"}
                </button>
                <button type="button" style={btn(busy !== null)} disabled={busy !== null} onClick={() => saveRows([...rowsRef.current, createRow()])}>
                    新增行
                </button>
                <button type="button" style={btn(busy !== null || !checkedRows.length)} disabled={busy !== null || !checkedRows.length} onClick={generateImages}>
                    批量出图{checkedRows.length ? ` (${checkedRows.length})` : ""}
                </button>
                <button type="button" title="只对勾选且已出图的行可用" style={btn(busy !== null || !videoRows.length)} disabled={busy !== null || !videoRows.length} onClick={generateVideos}>
                    批量出视频{videoRows.length ? ` (${videoRows.length})` : ""}
                </button>
                <span style={{ color: theme.node.muted, marginLeft: 4 }}>{message}</span>
            </div>
            <div onWheel={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, overflow: "auto", border: `1px solid ${theme.node.stroke}`, borderRadius: 8 }}>
                {rows.length ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                        <colgroup>
                            <col style={{ width: 28 }} />
                            <col style={{ width: 40 }} />
                            <col style={{ width: 60 }} />
                            <col style={{ width: 76 }} />
                            <col />
                            <col style={{ width: 100 }} />
                            <col style={{ width: 64 }} />
                            <col style={{ width: 32 }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th style={th}>
                                    <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? [] : rows.map((row) => row.id))} />
                                </th>
                                <th style={th}>镜号</th>
                                <th style={th}>时长(秒)</th>
                                <th style={th}>景别</th>
                                <th style={th}>画面描述</th>
                                <th style={th}>角色/主体</th>
                                <th style={th}>状态</th>
                                <th style={th} />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <td style={td}>
                                        <input type="checkbox" checked={checked.includes(row.id)} onChange={() => toggle(row.id)} />
                                    </td>
                                    <td style={{ ...td, color: theme.node.muted }}>{row.shot}</td>
                                    <td style={td}>
                                        <input type="number" min={1} value={row.seconds} onChange={(e) => patchRow(row.id, { seconds: Number(e.target.value) || 0 })} onBlur={(e) => patchRow(row.id, { seconds: toSeconds(e.target.value) })} style={cellInput} />
                                    </td>
                                    <td style={td}>
                                        <input value={row.framing} onChange={(e) => patchRow(row.id, { framing: e.target.value })} style={cellInput} />
                                    </td>
                                    <td style={td}>
                                        <textarea value={row.description} rows={2} onChange={(e) => patchRow(row.id, { description: e.target.value })} style={{ ...cellInput, resize: "vertical", lineHeight: 1.4 }} />
                                    </td>
                                    <td style={td}>
                                        <input value={row.subject} onChange={(e) => patchRow(row.id, { subject: e.target.value })} style={cellInput} />
                                    </td>
                                    <td style={{ ...td, color: rowStates[row.id] === "error" ? theme.node.text : theme.node.muted, fontWeight: rowStates[row.id] === "error" ? 600 : undefined, whiteSpace: "nowrap" }}>{stateLabel(row)}</td>
                                    <td style={td}>
                                        <button type="button" title="删除该行" disabled={busy !== null} onClick={() => removeRow(row.id)} style={{ border: "none", background: "transparent", color: theme.node.muted, cursor: busy !== null ? "not-allowed" : "pointer", fontSize: 14, padding: 0 }}>
                                            ×
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div style={{ padding: 16, color: theme.node.placeholder, textAlign: "center" }}>点「拆分镜」由模型生成分镜表，或点「新增行」手动填写</div>
                )}
            </div>
        </div>
    );
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? `${fallback}：${error.message}` : fallback;
}

export default definePlugin({
    id: "storyboard",
    name: "分镜脚本节点",
    version: "1.0.0",
    description: "剧本拆分镜表，批量出图出视频",
    nodes: [
        {
            type: "storyboard:node",
            title: "分镜脚本",
            icon: "🎬",
            description: "剧本拆分镜表，批量出图出视频",
            defaultSize: { width: 720, height: 480 },
            defaultMetadata: { script: "", rows: [] },
            minimapColor: "#f97316",
            // 节点自带完整操作界面,不弹出下方内置生成面板
            hidePanel: true,
            Content: StoryboardContent,
        },
    ],
});
