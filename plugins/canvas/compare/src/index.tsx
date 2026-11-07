// 对比节点:取上游前两张图片,滑块对比或并排对比。纯展示,不调用模型。
import { definePlugin, getUpstreamImages, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";
import { clampPercent, normalizeMode, percentFromPointer, pickPair } from "./logic";
import type { CompareMode } from "./logic";

function CompareContent({ ctx }: CanvasNodeContentProps) {
    // 分隔线位置只是查看状态,不写入 metadata,避免拖动时频繁持久化
    const [percent, setPercent] = useState(50);
    const draggingRef = useRef(false);
    const stageRef = useRef<HTMLDivElement>(null);

    const mode = normalizeMode(ctx.node.metadata?.compareMode);
    const pair = pickPair(getUpstreamImages(ctx));
    const { node, toolbar } = ctx.theme;

    const moveTo = (clientX: number) => {
        const rect = stageRef.current?.getBoundingClientRect();
        if (rect) setPercent(percentFromPointer(clientX, rect.left, rect.width));
    };

    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

    const modeButton = (value: CompareMode, label: string) => {
        const active = mode === value;
        return (
            <button
                type="button"
                onClick={() => ctx.updateMetadata({ compareMode: value })}
                style={{ padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, background: active ? toolbar.activeBg : "transparent", color: active ? toolbar.activeText : toolbar.item }}
            >
                {label}
            </button>
        );
    };

    const imageStyle = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", userSelect: "none" } as const;

    return (
        // 只给交互控件(模式切换、滑块区)加 no-zoom 并拦截 mousedown,其余区域仍可拖动节点、滚轮缩放
        <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 10, boxSizing: "border-box", color: node.text }}>
            <div data-canvas-no-zoom onMouseDown={stop} style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, border: `1px solid ${toolbar.border}`, background: toolbar.panel }}>
                    {modeButton("slider", "滑块")}
                    {modeButton("side", "并排")}
                </div>
                {pair && mode === "slider" ? <span style={{ fontSize: 12, color: node.muted }}>{Math.round(clampPercent(percent))}%</span> : null}
            </div>

            {!pair ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, border: `1px dashed ${node.stroke}`, color: node.placeholder, fontSize: 13 }}>连入两张图片进行对比</div>
            ) : mode === "side" ? (
                <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 6 }}>
                    {pair.map((src, index) => (
                        <div key={index} style={{ position: "relative", flex: 1, borderRadius: 8, overflow: "hidden", background: node.panel }}>
                            <img src={src} alt={`图${index + 1}`} draggable={false} style={imageStyle} />
                        </div>
                    ))}
                </div>
            ) : (
                <div
                    ref={stageRef}
                    data-canvas-no-zoom
                    onMouseDown={stop}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        draggingRef.current = true;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        moveTo(e.clientX);
                    }}
                    onPointerMove={(e) => {
                        if (draggingRef.current) moveTo(e.clientX);
                    }}
                    onPointerUp={(e) => {
                        draggingRef.current = false;
                        e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                    onPointerCancel={() => {
                        draggingRef.current = false;
                    }}
                    style={{ position: "relative", flex: 1, minHeight: 0, borderRadius: 8, overflow: "hidden", background: node.panel, cursor: "ew-resize", touchAction: "none" }}
                >
                    {/* 底层为第二张(右),上层第一张(左)按分隔线裁切 */}
                    <img src={pair[1]} alt="图2" draggable={false} style={imageStyle} />
                    <img src={pair[0]} alt="图1" draggable={false} style={{ ...imageStyle, clipPath: `inset(0 ${100 - percent}% 0 0)` }} />
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: `${percent}%`, width: 2, marginLeft: -1, background: node.activeStroke, pointerEvents: "none" }}>
                        <div style={{ position: "absolute", top: "50%", left: "50%", width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: "50%", background: toolbar.panel, border: `2px solid ${node.activeStroke}`, boxSizing: "border-box" }} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default definePlugin({
    id: "compare",
    name: "对比节点",
    version: "1.0.0",
    description: "两张图片滑块或并排对比",
    nodes: [
        {
            type: "compare:node",
            title: "对比",
            icon: "🔀",
            description: "两张图片滑块或并排对比",
            defaultSize: { width: 480, height: 360 },
            defaultMetadata: { compareMode: "slider" },
            minimapColor: "#0ea5e9",
            // 纯展示节点:不弹出下方生成面板,也不作为上游资源输出
            hidePanel: true,
            Content: CompareContent,
        },
    ],
});
