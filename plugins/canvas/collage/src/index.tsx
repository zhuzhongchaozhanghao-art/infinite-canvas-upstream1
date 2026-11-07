// 拼图合成节点:收集上游全部图片按网格排版,节点内实时预览,「导出为图片」生成一个新的图片节点(PNG)。
import { buildImageNodeOps, definePlugin, getUpstreamImages, readImageSize, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext, CanvasNodeData } from "@infinite-canvas/plugin-sdk";
import { applyOrder, computeCollageLayout, fitImage, moveKey } from "./logic";
import type { CellRatio, Size } from "./logic";

// 导出时每格宽度(像素);预览按同一布局等比缩放,保证与导出一致
const EXPORT_CELL_WIDTH = 1024;
const RATIO_OPTIONS: { value: CellRatio; label: string }[] = [
    { value: "original", label: "按原图" },
    { value: "1:1", label: "1:1" },
    { value: "3:4", label: "3:4" },
    { value: "4:3", label: "4:3" },
    { value: "9:16", label: "9:16" },
];
const DEFAULTS = { collageColumns: 2, collageGap: 16, collageBackground: "#ffffff", collageCellRatio: "original" as CellRatio };

type SourceItem = { key: string; urls: string[] };

// 上游图片按来源节点分组(组节点展开为成员),便于按节点 id 存排序;单节点取图复用 SDK 的 getUpstreamImages
function collectSources(ctx: CanvasNodeContext): SourceItem[] {
    const leaves = ctx.getUpstream().flatMap((node) => (node.type === "group" ? ctx.getNodes().filter((item) => item.metadata?.groupId === node.id) : [node]));
    const seen = new Set<string>();
    const sources: SourceItem[] = [];
    for (const leaf of leaves) {
        if (sources.some((item) => item.key === leaf.id)) continue;
        const urls = getUpstreamImages({ ...ctx, getUpstream: () => [leaf as CanvasNodeData] }).filter((url) => !seen.has(url));
        urls.forEach((url) => seen.add(url));
        if (urls.length) sources.push({ key: leaf.id, urls });
    }
    return sources;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        // 远程图需要跨域许可,否则画布被污染无法导出
        if (!src.startsWith("data:")) image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片加载失败"));
        image.src = src;
    });
}

function newNodeId() {
    return `collage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function CollageContent({ ctx }: CanvasNodeContentProps) {
    const meta = ctx.node.metadata || {};
    const columns = Number(meta.collageColumns ?? DEFAULTS.collageColumns);
    const savedGap = Number(meta.collageGap ?? DEFAULTS.collageGap);
    const savedBackground = String(meta.collageBackground ?? DEFAULTS.collageBackground);
    const cellRatio = (meta.collageCellRatio as CellRatio | undefined) ?? DEFAULTS.collageCellRatio;
    const order = Array.isArray(meta.collageOrder) ? (meta.collageOrder as string[]) : [];

    // 间距滑块与取色器高频变化:本地预览 + 节流提交,避免每次都写宿主 store
    const [draft, setDraft] = useState<{ gap?: number; background?: string }>({});
    const commitTimerRef = useRef<number | null>(null);
    // 节流期内累积的待提交改动:先调间距再调背景色时两项都要提交,不能只提交最后一次
    const pendingRef = useRef<{ gap?: number; background?: string }>({});
    const gap = draft.gap ?? savedGap;
    const background = draft.background ?? savedBackground;
    const updateDraft = (patch: { gap?: number; background?: string }) => {
        setDraft((prev) => ({ ...prev, ...patch }));
        pendingRef.current = { ...pendingRef.current, ...patch };
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null;
            const pending = pendingRef.current;
            pendingRef.current = {};
            ctx.updateMetadata({ ...(pending.gap !== undefined ? { collageGap: pending.gap } : {}), ...(pending.background !== undefined ? { collageBackground: pending.background } : {}) });
        }, 150);
    };
    // 卸载时(如节点移出可视区)把未提交的改动立即写回,避免丢失
    useEffect(() => () => {
        if (!commitTimerRef.current) return;
        clearTimeout(commitTimerRef.current);
        const pending = pendingRef.current;
        ctx.updateMetadata({ ...(pending.gap !== undefined ? { collageGap: pending.gap } : {}), ...(pending.background !== undefined ? { collageBackground: pending.background } : {}) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // 宿主值真正变化(提交完成 / 撤销重做)后回到 store 为准
    useEffect(() => setDraft({}), [savedGap, savedBackground]);

    const sources = applyOrder(collectSources(ctx), order);
    const urls = sources.flatMap((item) => item.urls);

    // 图片原始尺寸缓存;读取失败记 null,不参与排版
    const [sizes, setSizes] = useState<Record<string, Size | null>>({});
    const urlsKey = urls.join("\n");
    useEffect(() => {
        let cancelled = false;
        urls.filter((url) => !(url in sizes)).forEach((url) => {
            readImageSize(url)
                .then((size) => !cancelled && setSizes((prev) => ({ ...prev, [url]: size })))
                .catch(() => !cancelled && setSizes((prev) => ({ ...prev, [url]: null })));
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlsKey]);

    const ready = urls.filter((url) => sizes[url]);
    const pending = urls.some((url) => !(url in sizes));
    const layoutOptions = { columns, gap, cellRatio, cellWidth: EXPORT_CELL_WIDTH };
    const layout = computeCollageLayout(ready.map((url) => sizes[url]!), layoutOptions);
    const fitMode = cellRatio === "original" ? "contain" : "cover";

    // 预览区尺寸:跟随节点缩放
    const previewRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const el = previewRef.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const scale = layout.width && layout.height ? Math.min(box.width / layout.width, box.height / layout.height) : 0;

    const [dragKey, setDragKey] = useState<string | null>(null);
    const dropOn = (targetKey: string) => {
        if (!dragKey) return;
        const next = moveKey(sources.map((item) => item.key), dragKey, targetKey);
        setDragKey(null);
        ctx.updateMetadata({ collageOrder: next });
    };

    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState("");
    const exportImage = async () => {
        if (!ready.length || exporting) return;
        setExporting(true);
        setError("");
        try {
            const images = await Promise.all(ready.map(loadImage));
            const canvas = document.createElement("canvas");
            canvas.width = layout.width;
            canvas.height = layout.height;
            const g = canvas.getContext("2d");
            if (!g) throw new Error("浏览器不支持画布导出");
            g.fillStyle = background;
            g.fillRect(0, 0, layout.width, layout.height);
            images.forEach((image, index) => {
                const cell = layout.cells[index];
                const fit = fitImage({ width: image.naturalWidth, height: image.naturalHeight }, cell, fitMode);
                if (fit.sw && fit.sh) g.drawImage(image, fit.sx, fit.sy, fit.sw, fit.sh, fit.dx, fit.dy, fit.dw, fit.dh);
                else g.drawImage(image, fit.dx, fit.dy, fit.dw, fit.dh);
            });
            const dataUrl = canvas.toDataURL("image/png");
            const origin = { x: ctx.node.position.x + ctx.node.width + 80, y: ctx.node.position.y };
            ctx.applyOps(buildImageNodeOps(ctx.node.id, [{ id: newNodeId(), title: `拼图 ${images.length} 张`, dataUrl, width: layout.width, height: layout.height }], origin));
        } catch (err) {
            setError(err instanceof Error && err.name === "SecurityError" ? "存在跨域图片,无法导出" : err instanceof Error ? err.message : "导出失败");
        } finally {
            setExporting(false);
        }
    };

    const { theme } = ctx;
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
    const fieldStyle = { background: theme.node.panel, color: theme.node.text, border: `1px solid ${theme.node.stroke}`, borderRadius: 6, fontSize: 12, padding: "2px 4px" };
    const labelStyle = { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: theme.node.muted };

    return (
        <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 10, boxSizing: "border-box", color: theme.node.text }}>
            {/* 设置项 */}
            <div data-canvas-no-zoom onMouseDown={stop} onPointerDown={stop} onDoubleClick={stop} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <label style={labelStyle}>
                    列数
                    <select value={columns} onChange={(e) => ctx.updateMetadata({ collageColumns: Number(e.target.value) })} style={fieldStyle}>
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={labelStyle}>
                    间距
                    <input type="range" min={0} max={80} value={gap} onChange={(e) => updateDraft({ gap: Number(e.target.value) })} style={{ width: 64 }} />
                    <span style={{ minWidth: 30 }}>{gap}px</span>
                </label>
                <label style={labelStyle}>
                    背景
                    <input type="color" value={background} onChange={(e) => updateDraft({ background: e.target.value })} style={{ width: 24, height: 20, padding: 0, border: `1px solid ${theme.node.stroke}`, borderRadius: 4, background: "transparent" }} />
                </label>
                <label style={labelStyle}>
                    比例
                    <select value={cellRatio} onChange={(e) => ctx.updateMetadata({ collageCellRatio: e.target.value })} style={fieldStyle}>
                        {RATIO_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    disabled={!ready.length || pending || exporting}
                    onClick={exportImage}
                    style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "none", cursor: ready.length && !pending && !exporting ? "pointer" : "not-allowed", background: theme.toolbar.activeBg, color: theme.toolbar.activeText, opacity: ready.length && !pending && !exporting ? 1 : 0.5 }}
                >
                    {exporting ? "导出中…" : "导出为图片"}
                </button>
            </div>

            {/* 缩略图:拖动调整顺序 */}
            {sources.length > 1 ? (
                <div data-canvas-no-zoom onMouseDown={stop} onPointerDown={stop} onWheel={stop} style={{ display: "flex", gap: 6, overflowX: "auto", flexShrink: 0 }}>
                    {sources.map((item, index) => (
                        <img
                            key={item.key}
                            src={item.urls[0]}
                            alt={`图${index + 1}`}
                            title="拖动调整顺序"
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = "move";
                                setDragKey(item.key);
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                dropOn(item.key);
                            }}
                            onDragEnd={() => setDragKey(null)}
                            style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0, cursor: "grab", opacity: dragKey === item.key ? 0.4 : 1, border: `1px solid ${theme.node.stroke}` }}
                        />
                    ))}
                </div>
            ) : null}

            {/* 实时预览:按导出布局等比缩放 */}
            <div ref={previewRef} style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {!urls.length ? (
                    <span style={{ fontSize: 13, color: theme.node.placeholder }}>连入图片节点开始拼图</span>
                ) : scale > 0 ? (
                    <div style={{ position: "relative", width: layout.width * scale, height: layout.height * scale, background, boxShadow: `0 0 0 1px ${theme.node.stroke}` }}>
                        {ready.map((url, index) => {
                            const cell = layout.cells[index];
                            return (
                                <div key={url} style={{ position: "absolute", left: cell.x * scale, top: cell.y * scale, width: cell.width * scale, height: cell.height * scale, overflow: "hidden" }}>
                                    <img src={url} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: fitMode, display: "block" }} />
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <span style={{ fontSize: 13, color: theme.node.placeholder }}>{pending ? "读取图片中…" : "图片读取失败"}</span>
                )}
            </div>

            {error ? <div style={{ fontSize: 12, color: theme.node.text }}>⚠ {error}</div> : null}
        </div>
    );
}

export default definePlugin({
    id: "collage",
    name: "拼图合成节点",
    version: "1.0.0",
    description: "上游图片按网格排版导出为一张图",
    nodes: [
        {
            type: "collage:node",
            title: "拼图合成",
            icon: "🧩",
            description: "上游图片按网格排版导出为一张图",
            defaultSize: { width: 420, height: 420 },
            defaultMetadata: { ...DEFAULTS, collageOrder: [] },
            minimapColor: "#8b5cf6",
            // 设置项都在节点内,不弹出下方生成面板
            hidePanel: true,
            Content: CollageContent,
        },
    ],
});
