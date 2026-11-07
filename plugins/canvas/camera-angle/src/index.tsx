import { definePlugin, getUpstreamImages, readImageSize, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";
import type { PointerEvent } from "react";

function angleLabel(horizontal: number, pitch: number) {
    const degrees = Math.abs(horizontal);
    const side = degrees === 0 ? "正前方" : degrees === 180 ? "正后方 180°" : `画面${horizontal > 0 ? "右" : "左"}${degrees === 90 ? "侧面" : degrees > 90 ? "后方" : "前方"} ${degrees}°`;
    const height = pitch === 0 ? "平视" : Math.abs(pitch) === 90 ? (pitch > 0 ? "正上方 90°" : "正下方 90°") : `${pitch > 0 ? "俯拍" : "仰拍"} ${Math.abs(pitch)}°`;
    return `${side} · ${height}`;
}

function directionLabel(horizontal: number, pitch: number) {
    if (pitch === 90) return "正上方";
    if (pitch === -90) return "正下方";
    const degrees = Math.abs(horizontal);
    const side = degrees === 0 ? "正面" : degrees === 180 ? "背面" : `${horizontal > 0 ? "右" : "左"}${degrees === 90 ? "侧面" : degrees > 90 ? "后方" : "前方"}`;
    return `${side} · ${pitch > 0 ? "俯拍" : pitch < 0 ? "仰拍" : "平视"}`;
}

function anglePrompt(horizontal: number, pitch: number) {
    return `以参考图的机位为正前方 0°，将相机绕主体移到${angleLabel(horizontal, pitch)}，镜头始终朝向主体，重新拍摄同一场景。主体保持原位和原有姿态；保留主体身份与外观细节，人物的面容、发型、服装款式，以及已有道具和背景的空间关系。根据新视角自然补全原图未呈现的部分。生成一张新视角图，不要直接旋转或透视拉伸原图。`;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function wrapYaw(value: number) {
    const angle = Math.round(value);
    return angle >= -180 && angle <= 180 ? angle : ((angle + 180) % 360 + 360) % 360 - 180;
}

function CameraAngleContent({ ctx }: CanvasNodeContentProps) {
    const reference = getUpstreamImages(ctx)[0];
    const horizontal = wrapYaw(Number(ctx.node.metadata?.cameraHorizontal) || 0);
    const pitch = clamp(Number(ctx.node.metadata?.cameraPitch) || 0, -90, 90);
    const yawRadians = horizontal * Math.PI / 180;
    const pitchRadians = pitch * Math.PI / 180;
    const cameraX = Math.sin(yawRadians) * Math.cos(pitchRadians) * 84;
    const cameraY = (Math.cos(yawRadians) * Math.cos(pitchRadians) * 0.85 - Math.sin(pitchRadians) * 0.75) * 82;
    const cameraBehind = Math.cos(yawRadians) * Math.cos(pitchRadians) < 0;
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState("");
    const [dragging, setDragging] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number; horizontal: number; pitch: number } | null>(null);
    const theme = ctx.theme;

    const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
    };

    const generate = async () => {
        if (!reference || running) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setMessage("生成中…");
        try {
            const prompt = anglePrompt(horizontal, pitch);
            const result = await ctx.ai.generateImage(prompt, { references: [reference], count: 1, signal: controller.signal });
            const image = result.images[0];
            if (!image) throw new Error("模型没有返回图片");
            const size = await readImageSize(image);
            if (controller.signal.aborted) {
                setMessage("已取消");
                return;
            }
            const id = `camera-angle-${ctx.node.id}-${Date.now().toString(36)}`;
            const width = 240;
            const previous = ctx.getDownstream().filter((node) => node.type === "image" && node.id.startsWith(`camera-angle-${ctx.node.id}-`));
            const y = previous.length ? Math.max(...previous.map((node) => node.position.y + node.height)) + 24 : ctx.node.position.y;
            ctx.applyOps([
                {
                    type: "add_node", id, nodeType: "image", title: angleLabel(horizontal, pitch),
                    position: { x: ctx.node.position.x + ctx.node.width + 80, y },
                    width, height: Math.round((width * size.height) / size.width),
                    metadata: { content: image, prompt, status: "success", naturalWidth: size.width, naturalHeight: size.height, mimeType: image.match(/^data:([^;,]+)/)?.[1] || "image/png" },
                },
                { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
                { type: "select_nodes", ids: [id] },
            ]);
            setMessage("已生成 1 张新角度图片");
        } catch (error) {
            setMessage(controller.signal.aborted ? "已取消" : `生成失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const labelStyle = { color: theme.node.muted, fontSize: 11 } as const;
    const ring = { position: "absolute", left: "50%", top: "50%", borderRadius: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" } as const;
    return (
        <div data-canvas-no-zoom onMouseDown={(event) => {
            if (event.target instanceof Element && event.target.closest("[data-camera-orbit], input, button")) event.stopPropagation();
        }} onWheel={(event) => event.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", height: "100%", padding: 10, boxSizing: "border-box", color: theme.node.text, overflow: "auto" }}>
            <div data-camera-orbit role="group" tabIndex={0} aria-label={`球形机位：${angleLabel(horizontal, pitch)}。拖动或使用方向键调整`} onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, horizontal, pitch };
                setDragging(true);
            }} onPointerMove={(event) => {
                const start = dragRef.current;
                if (!start || start.pointerId !== event.pointerId) return;
                const speed = 0.6 / Math.max(ctx.scale, 0.1);
                ctx.updateMetadata({
                    cameraHorizontal: wrapYaw(start.horizontal + (event.clientX - start.x) * speed),
                    cameraPitch: clamp(Math.round(start.pitch - (event.clientY - start.y) * speed), -90, 90),
                });
            }} onPointerUp={stopDrag} onPointerCancel={stopDrag} onKeyDown={(event) => {
                const step = event.shiftKey ? 5 : 1;
                const patch = event.key === "ArrowLeft" ? { cameraHorizontal: wrapYaw(horizontal - step) }
                    : event.key === "ArrowRight" ? { cameraHorizontal: wrapYaw(horizontal + step) }
                        : event.key === "ArrowUp" ? { cameraPitch: clamp(pitch + step, -90, 90) }
                            : event.key === "ArrowDown" ? { cameraPitch: clamp(pitch - step, -90, 90) } : null;
                if (patch) {
                    event.preventDefault();
                    event.stopPropagation();
                    ctx.updateMetadata(patch);
                }
            }} style={{ position: "relative", flex: "1 0 158px", minHeight: 158, overflow: "hidden", borderRadius: 12, cursor: dragging ? "grabbing" : "grab", touchAction: "none", outlineColor: theme.node.activeStroke, perspective: 500 }}>
                <div aria-hidden style={{ ...ring, width: 186, height: 186, border: `1px solid ${theme.node.muted}`, background: `radial-gradient(circle at 34% 26%, color-mix(in srgb, ${theme.node.activeStroke} 12%, ${theme.node.panel}), ${theme.node.panel} 76%)`, boxShadow: `inset 0 -16px 24px color-mix(in srgb, ${theme.node.stroke} 65%, transparent)`, opacity: 0.8 }} />
                <div aria-hidden style={{ ...ring, width: 180, height: 68, borderTop: `1px dashed ${theme.node.muted}`, borderBottom: `1px solid ${theme.node.activeStroke}`, transform: `translate(-50%, -50%) rotateX(${pitch}deg) rotateY(${horizontal}deg)`, transition: dragging ? "none" : "transform 160ms ease-out", opacity: 0.55 }} />
                <div aria-hidden style={{ ...ring, width: 68, height: 180, borderLeft: `1px dashed ${theme.node.muted}`, borderRight: `1px solid ${theme.node.activeStroke}`, transform: `translate(-50%, -50%) rotateY(${horizontal}deg) rotateX(${-pitch}deg)`, transition: dragging ? "none" : "transform 160ms ease-out", opacity: 0.5 }} />
                <svg aria-hidden viewBox="0 0 186 186" style={{ position: "absolute", left: "50%", top: "50%", width: 186, height: 186, overflow: "visible", transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
                    <path d={`M93 93 Q${93 + cameraX * 0.4} ${93 + cameraY * 0.4} ${93 + cameraX} ${93 + cameraY}`} fill="none" stroke={theme.node.activeStroke} strokeWidth="1.5" strokeDasharray="3 4" opacity={cameraBehind ? 0.26 : 0.48} />
                </svg>
                <div aria-hidden style={{ position: "absolute", left: `calc(50% + ${cameraX}px)`, top: `calc(50% + ${cameraY}px)`, display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: "50%", border: `1px solid ${theme.node.activeStroke}`, background: theme.node.panel, boxShadow: `0 0 0 3px ${theme.node.panel}`, color: theme.node.activeStroke, transform: "translate(-50%, -50%)", opacity: cameraBehind ? 0.75 : 1, pointerEvents: "none" }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.5h2l1-1.5h6l1 1.5h2v7H2z" /><circle cx="8" cy="9" r="2.2" /></svg>
                </div>
                <div style={{ position: "absolute", left: `calc(50% + ${Math.sin(yawRadians) * Math.cos(pitchRadians) * 22}px)`, top: `calc(50% - ${Math.sin(pitchRadians) * 18}px)`, width: 94, height: 138, transform: `translate(-50%, -50%) rotateY(${-horizontal}deg) rotateX(${pitch}deg)`, transformStyle: "preserve-3d", transition: dragging ? "none" : "left 160ms ease-out, top 160ms ease-out, transform 160ms ease-out", pointerEvents: "none" }}>
                    <div style={{ position: "absolute", inset: 0, border: `1px solid ${theme.node.activeStroke}`, borderRadius: 5, background: theme.node.panel, boxShadow: `0 8px 22px ${theme.node.stroke}`, overflow: "hidden", backfaceVisibility: "hidden" }}>
                        {reference ? <img src={reference} alt="参考原图" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", padding: 8, boxSizing: "border-box", textAlign: "center", ...labelStyle }}>连接人物图片</span>}
                    </div>
                    <div aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 8, boxSizing: "border-box", textAlign: "center", border: `1px dashed ${theme.node.muted}`, borderRadius: 5, background: theme.node.panel, color: theme.node.muted, fontSize: 11, transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>背面待生成</div>
                </div>
                <span style={{ position: "absolute", left: 4, top: 2, fontSize: 10, color: theme.node.text, pointerEvents: "none" }}>相机 · {directionLabel(horizontal, pitch)}</span>
                <span style={{ position: "absolute", left: 4, bottom: 2, fontSize: 10, color: theme.node.muted, pointerEvents: "none" }}>拖动球体调整机位</span>
                <span style={{ position: "absolute", right: 4, top: 2, fontSize: 10, color: theme.node.muted, pointerEvents: "none" }}>{horizontal}° / {pitch}°</span>
            </div>
            <label style={labelStyle}>左右机位 <strong style={{ float: "right", color: theme.node.text }}>{horizontal}°</strong>
                <input type="range" min={-180} max={180} value={horizontal} onChange={(event) => ctx.updateMetadata({ cameraHorizontal: Number(event.target.value) })} style={{ display: "block", width: "100%", margin: "8px 0 0", accentColor: theme.node.stroke }} />
                <span style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}><span>背面</span><span>左侧</span><span>正面</span><span>右侧</span><span>背面</span></span>
            </label>
            <label style={labelStyle}>上下角度 <strong style={{ float: "right", color: theme.node.text }}>{pitch}°</strong>
                <input type="range" min={-90} max={90} value={pitch} onChange={(event) => ctx.updateMetadata({ cameraPitch: Number(event.target.value) })} style={{ display: "block", width: "100%", margin: "8px 0 0", accentColor: theme.node.stroke }} />
                <span style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}><span>正下方</span><span>平视</span><span>正上方</span></span>
            </label>
            <button type="button" disabled={!reference} onClick={running ? () => abortRef.current?.abort() : generate} style={{ alignSelf: "flex-start", padding: "6px 0", border: 0, background: "transparent", color: theme.node.text, cursor: reference ? "pointer" : "not-allowed", opacity: reference ? 1 : 0.45, fontSize: 12 }}>{running ? "取消" : "生成这个角度"}</button>
            {message ? <div style={{ ...labelStyle, overflowWrap: "anywhere" }}>{message}</div> : null}
        </div>
    );
}

export default definePlugin({
    id: "camera-angle",
    name: "换角度节点",
    version: "1.0.0",
    description: "从参考图调整拍摄机位并生成一张新角度图片",
    nodes: [{
        type: "camera-angle:node", title: "换角度", icon: "📷", description: "调整相机左右和上下角度生成新视角",
        defaultSize: { width: 300, height: 340 }, defaultMetadata: { cameraHorizontal: 0, cameraPitch: 0 },
        minimapColor: "#7b8cd0", hidePanel: true, Content: CameraAngleContent,
    }],
});
