import { definePlugin, useEffect, useRef, useState } from '@infinite-canvas/plugin-sdk';
import type { CanvasAgentOp, CanvasNodeContentProps, CanvasNodeData } from '@infinite-canvas/plugin-sdk';
import type { PointerEvent } from 'react';
import { createMannequinStage, FRAME_OPTIONS, POSE_OPTIONS } from './mannequin';
import type { Framing, PoseId } from './mannequin';

function imageSource(node?: CanvasNodeData) {
    return node?.type === 'image' && typeof node.metadata?.content === 'string' ? node.metadata.content : '';
}

async function persistentImageSource(source: string) {
    if (!source.startsWith('blob:')) return source;
    const response = await fetch(source);
    if (!response.ok) throw new Error('姿势参考图片读取失败');
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('姿势参考图片读取失败'));
        reader.onerror = () => reject(new Error('姿势参考图片读取失败'));
        reader.readAsDataURL(blob);
    });
}

function wrapYaw(value: number) {
    const angle = Math.round(value);
    return ((angle + 180) % 360 + 360) % 360 - 180;
}

function clampPitch(value: number) {
    return Math.max(-90, Math.min(90, Math.round(value)));
}

function cameraLabel(yaw: number, pitch: number) {
    const a = Math.abs(yaw);
    const side = a === 0 ? '正面' : a === 180 ? '背面' : (yaw > 0 ? '右' : '左') + (a === 90 ? '侧面' : a > 90 ? '后方' : '前方') + ' ' + a + '°';
    return side + ' · ' + (pitch === 0 ? '平视' : pitch > 0 ? '俯拍 ' + pitch + '°' : '仰拍 ' + Math.abs(pitch) + '°');
}

const imagePrompt = '参考图中有人物原图和姿势参考图。保留人物原图的身份、面容、发型、服装、鞋子、颜色、材质、背景和画面风格；只借用姿势参考图的身体朝向、手脚位置与重心。不要复制姿势参考图的人脸、衣服、道具或背景。生成同一人物的新姿势，保持合理的人体结构、衣服褶皱和光影。';

function PoseReferenceContent({ ctx }: CanvasNodeContentProps) {
    const inputs = ctx.getUpstream().filter((node) => imageSource(node));
    const person = inputs.find((node) => node.id === ctx.node.metadata?.posePersonId) || inputs[0];
    const guide = inputs.find((node) => node.id === ctx.node.metadata?.poseGuideId && node.id !== person?.id) || inputs.find((node) => node.id !== person?.id);
    const mode = ctx.node.metadata?.poseMode === 'mannequin' || ctx.node.metadata?.poseMode !== 'image' && !ctx.node.metadata?.poseGuideId ? 'mannequin' : 'image';
    const pose = POSE_OPTIONS.find((option) => option.id === ctx.node.metadata?.posePreset)?.id || 'pocket';
    const framing = FRAME_OPTIONS.find((option) => option.id === ctx.node.metadata?.poseFraming)?.id || 'full';
    const yaw = wrapYaw(Number(ctx.node.metadata?.poseYaw) || 0);
    const pitch = clampPitch(Number(ctx.node.metadata?.posePitch) || 0);
    const output = ctx.getDownstream().find((node) => node.type === 'image' && node.metadata?.poseReferenceTargetId === ctx.node.id);
    const guideSource = imageSource(guide);
    const guideVersion = guide?.metadata?.storageKey || [guideSource.length, guideSource.slice(-32)].join(':');
    const signature = mode === 'mannequin' ? [mode, pose, yaw, pitch, framing].join(':') : [mode, guide?.id, guideVersion].join(':');
    const needsSync = Boolean(output && ctx.node.metadata?.poseReferenceSignature !== signature);
    const [syncing, setSyncing] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [stageReady, setStageReady] = useState(false);
    const [stageError, setStageError] = useState('');
    const [message, setMessage] = useState('');
    const mountRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<ReturnType<typeof createMannequinStage> | null>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | null>(null);
    const theme = ctx.theme;

    useEffect(() => {
        if (mode !== 'mannequin') {
            setStageReady(false);
            return;
        }
        const mount = mountRef.current;
        if (!mount) return;
        let stage: ReturnType<typeof createMannequinStage> | null = null;
        let observer: ResizeObserver | null = null;
        try {
            stage = createMannequinStage({ pose, yaw, pitch, framing });
            mount.appendChild(stage.canvas);
            stageRef.current = stage;
            observer = new ResizeObserver(() => {
                if (stage) stage.resize(mount.clientWidth, mount.clientHeight);
            });
            observer.observe(mount);
            stage.resize(mount.clientWidth, mount.clientHeight);
            setStageReady(true);
            setStageError('');
        } catch (error) {
            setStageError(error instanceof Error ? error.message : String(error));
        }
        return () => {
            observer?.disconnect();
            stageRef.current = null;
            stage?.canvas.remove();
            stage?.dispose();
        };
    }, [mode]);

    useEffect(() => {
        stageRef.current?.update({ pose, yaw, pitch, framing });
    }, [pose, yaw, pitch, framing]);

    const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
    };

    const sendToImageNode = async () => {
        if (syncing || mode === 'image' && !guide || mode === 'mannequin' && !stageReady) return;
        setSyncing(true);
        try {
            const poseName = POSE_OPTIONS.find((option) => option.id === pose)?.label || '站姿';
            const frameName = FRAME_OPTIONS.find((option) => option.id === framing)?.label || '全身';
            const reference = mode === 'mannequin' ? stageRef.current?.capture() : await persistentImageSource(guideSource);
            if (!reference) throw new Error('参考姿势尚未就绪');
            const prompt = mode === 'mannequin'
                ? '参考图中有人物原图和无服装的3D白膜姿势示意。保留人物原图的面容、发型、身形、服装、鞋子、颜色、材质及原有背景；白膜只用于确定身体姿势、人物朝向、相机位置和画面取景，不要把白膜材质、无脸头部、地台或其他示意物体画进结果。按白膜的' + poseName + '姿势、' + cameraLabel(yaw, pitch) + '机位和' + frameName + '景别重新拍摄人物。若景别裁切身体，以白膜构图为准；保持合理的手脚、衣服褶皱和光影。'
                : imagePrompt;
            const existing = output;
            const id = existing?.id || 'pose-output-' + ctx.node.id + '-' + Date.now().toString(36);
            const ops: CanvasAgentOp[] = [{ type: 'update_node', id: ctx.node.id, metadata: { poseReferenceImage: reference, poseReferenceSignature: signature } }];
            if (existing) {
                const oldPersonId = existing.metadata?.poseReferencePersonId;
                const oldConnection = typeof oldPersonId === 'string' && oldPersonId !== person?.id ? ctx.getConnections().find((connection) => connection.fromNodeId === oldPersonId && connection.toNodeId === id) : undefined;
                if (oldConnection) ops.push({ type: 'delete_connections', ids: [oldConnection.id] });
                ops.push({ type: 'update_node', id, metadata: { poseReferencePersonId: person?.id || '', ...(existing.metadata?.prompt === existing.metadata?.poseReferencePrompt ? { prompt, poseReferencePrompt: prompt } : {}) } });
            } else ops.push({ type: 'add_node', id, nodeType: 'image', title: '姿势参考生图', position: { x: ctx.node.position.x + ctx.node.width + 80, y: ctx.node.position.y }, width: 260, height: 320, metadata: { prompt, poseReferencePrompt: prompt, poseReferenceTargetId: ctx.node.id, poseReferencePersonId: person?.id || '' } });
            if (person && !ctx.getConnections().some((connection) => connection.fromNodeId === person.id && connection.toNodeId === id)) ops.push({ type: 'connect_nodes', fromNodeId: person.id, toNodeId: id });
            if (!existing) ops.push({ type: 'connect_nodes', fromNodeId: ctx.node.id, toNodeId: id });
            ops.push({ type: 'select_nodes', ids: [id] });
            ctx.applyOps(ops);
            ctx.openNodePanel(id);
            setMessage(person ? '已连接参考姿势和人物原图，请在图片节点设置参数并生成。' : '已连接参考姿势，请在图片节点再连接人物原图并生成。');
        } catch (error) {
            setMessage('连接失败：' + (error instanceof Error ? error.message : String(error)));
        } finally {
            setSyncing(false);
        }
    };

    const imageCard = (title: string, selected: CanvasNodeData | undefined, key: 'posePersonId' | 'poseGuideId') => (
        <div style={{ minWidth: 0, padding: 8, border: '1px solid ' + theme.node.stroke, borderRadius: 10, background: theme.node.panel }}>
            <div style={{ marginBottom: 6, color: theme.node.text, fontSize: 12, fontWeight: 600 }}>{title}</div>
            <div style={{ position: 'relative', height: 138, borderRadius: 6, background: theme.node.fill, overflow: 'hidden' }}>
                {selected ? <img src={imageSource(selected)} alt={title} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ display: 'grid', placeItems: 'center', height: '100%', color: theme.node.muted, fontSize: 11 }}>连接图片节点</span>}
            </div>
            <select aria-label={title} value={selected?.id || ''} onChange={(event) => ctx.updateMetadata({ [key]: event.target.value })} style={{ width: '100%', marginTop: 7, padding: '4px 6px', border: '1px solid ' + theme.node.stroke, borderRadius: 6, background: theme.node.panel, color: theme.node.text, fontSize: 11 }}>
                {!selected ? <option value="">请选择图片</option> : null}
                {inputs.filter((node) => key === 'posePersonId' || node.id !== person?.id).map((node) => <option key={node.id} value={node.id}>{node.title || '未命名图片'}</option>)}
            </select>
        </div>
    );
    const selectStyle = { width: '100%', marginTop: 4, padding: '5px 6px', border: '1px solid ' + theme.node.stroke, borderRadius: 6, background: theme.node.panel, color: theme.node.text, fontSize: 12 };
    const labelStyle = { color: theme.node.muted, fontSize: 11 };

    return (
        <div data-canvas-no-zoom onMouseDown={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-pose-orbit], select, button, input')) event.stopPropagation();
        }} onWheel={(event) => event.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 9, width: '100%', height: '100%', padding: 12, boxSizing: 'border-box', overflow: 'auto', color: theme.node.text }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 12 }}>姿势摄影台</strong>
                <span style={{ fontSize: 10, color: theme.node.muted }}>{mode === 'mannequin' ? '3D 白膜' : '图片参考'}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, borderBottom: '1px solid ' + theme.node.stroke }}>
                {(['mannequin', 'image'] as const).map((item) => (
                    <button key={item} type="button" onClick={() => ctx.updateMetadata({ poseMode: item })} style={{ padding: '4px 1px 7px', border: 0, borderBottom: mode === item ? '2px solid ' + theme.node.activeStroke : '2px solid transparent', background: 'transparent', color: mode === item ? theme.node.text : theme.node.muted, fontSize: 11, cursor: 'pointer' }}>{item === 'mannequin' ? '白膜工作台' : '图片参考'}</button>
                ))}
            </div>
            {mode === 'mannequin' ? (
                <>
                    <div data-pose-orbit role="group" tabIndex={0} aria-label={'白膜机位：' + cameraLabel(yaw, pitch) + '。拖动或使用方向键调整'} onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.stopPropagation();
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch };
                        setDragging(true);
                    }} onPointerMove={(event) => {
                        const start = dragRef.current;
                        if (!start || start.pointerId !== event.pointerId) return;
                        const speed = 0.65 / Math.max(ctx.scale, 0.1);
                        ctx.updateMetadata({
                            poseYaw: wrapYaw(start.yaw + (event.clientX - start.x) * speed),
                            posePitch: clampPitch(start.pitch - (event.clientY - start.y) * speed),
                        });
                    }} onPointerUp={stopDrag} onPointerCancel={stopDrag} onKeyDown={(event) => {
                        const step = event.shiftKey ? 10 : 5;
                        const patch = event.key === 'ArrowLeft' ? { poseYaw: wrapYaw(yaw - step) }
                            : event.key === 'ArrowRight' ? { poseYaw: wrapYaw(yaw + step) }
                                : event.key === 'ArrowUp' ? { posePitch: clampPitch(pitch + step) }
                                    : event.key === 'ArrowDown' ? { posePitch: clampPitch(pitch - step) } : null;
                        if (patch) {
                            event.preventDefault();
                            event.stopPropagation();
                            ctx.updateMetadata(patch);
                        }
                    }} style={{ position: 'relative', alignSelf: 'center', width: 216, aspectRatio: '3 / 4', border: '1px solid ' + theme.node.stroke, borderRadius: 10, overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', outlineColor: theme.node.activeStroke, flexShrink: 0 }}>
                        <div ref={mountRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
                        {!stageReady ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: theme.node.muted, fontSize: 11, textAlign: 'center', padding: 12 }}>{stageError ? '3D 预览不可用：' + stageError : '载入白膜…'}</div> : null}
                        <span style={{ position: 'absolute', top: 7, left: 8, padding: '3px 5px', borderRadius: 5, background: 'rgba(255,255,255,.82)', color: '#383b42', fontSize: 10, pointerEvents: 'none' }}>{cameraLabel(yaw, pitch)}</span>
                        <span style={{ position: 'absolute', bottom: 7, left: 8, color: '#555a63', fontSize: 10, pointerEvents: 'none' }}>拖动调整机位</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label style={labelStyle}>姿势
                            <select aria-label="白膜姿势" value={pose} onChange={(event) => ctx.updateMetadata({ posePreset: event.target.value as PoseId })} style={selectStyle}>
                                {POSE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                            </select>
                        </label>
                        <label style={labelStyle}>景别
                            <select aria-label="景别" value={framing} onChange={(event) => ctx.updateMetadata({ poseFraming: event.target.value as Framing })} style={selectStyle}>
                                {FRAME_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                            </select>
                        </label>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: theme.node.muted }}>
                        <span>机位 {yaw}° / {pitch}°</span>
                        <button type="button" onClick={() => ctx.updateMetadata({ poseYaw: 0, posePitch: 0 })} style={{ padding: 2, border: 0, background: 'transparent', color: theme.node.text, cursor: 'pointer', fontSize: 11 }}>回正</button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {person ? <img src={imageSource(person)} alt="人物原图" draggable={false} style={{ width: 34, height: 42, objectFit: 'contain', borderRadius: 4, background: theme.node.panel }} /> : null}
                        <label style={{ ...labelStyle, flex: 1, minWidth: 0 }}>人物原图
                            <select aria-label="人物原图" value={person?.id || ''} onChange={(event) => ctx.updateMetadata({ posePersonId: event.target.value })} style={selectStyle}>
                                {!person ? <option value="">连接图片节点</option> : null}
                                {inputs.map((node) => <option key={node.id} value={node.id}>{node.title || '未命名图片'}</option>)}
                            </select>
                        </label>
                    </div>
                </>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
                        {imageCard('人物原图', person, 'posePersonId')}
                        {imageCard('姿势参考', guide, 'poseGuideId')}
                    </div>
                    <div style={labelStyle}>保留人物与服装，只借用右图的身体姿势。</div>
                </>
            )}
            <button type="button" disabled={syncing || (mode === 'image' ? !guide : !stageReady)} onClick={sendToImageNode} style={{ alignSelf: 'flex-start', padding: '7px 12px', border: '1px solid ' + theme.node.activeStroke, borderRadius: 8, background: 'transparent', color: theme.node.text, cursor: 'pointer', opacity: mode === 'image' ? guide ? 1 : 0.45 : stageReady ? 1 : 0.45, fontSize: 12, fontWeight: 600 }}>{syncing ? '读取参考图…' : output ? '更新参考姿势 →' : '在图片节点生成 →'}</button>
            {needsSync || message ? <div style={{ ...labelStyle, overflowWrap: 'anywhere' }}>{needsSync ? '姿势已调整，点击按钮同步到图片节点。' : message}</div> : null}
        </div>
    );
}

export default definePlugin({
    id: 'pose-reference',
    name: '姿势参考节点',
    version: '1.2.0',
    description: '3D 白膜选姿势、机位与景别，或从图片借用姿势',
    nodes: [{
        type: 'pose-reference:node', title: '姿势参考', icon: '🕺', description: '白膜工作台或图片参考，将姿势连接到图片生成节点',
        defaultSize: { width: 390, height: 540 }, defaultMetadata: { poseMode: 'mannequin', posePreset: 'pocket', poseYaw: 0, posePitch: 0, poseFraming: 'full' },
        minimapColor: '#7b8cd0', hidePanel: true, Content: PoseReferenceContent,
        resource: (node) => typeof node.metadata?.poseReferenceImage === 'string' && node.metadata.poseReferenceImage ? { kind: 'image', url: node.metadata.poseReferenceImage, caption: '参考姿势' } : null,
    }],
});
