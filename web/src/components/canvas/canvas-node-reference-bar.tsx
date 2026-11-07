import { FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { Popover } from "antd";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { useCanvasTheme } from "@/hooks/use-canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { buildReferenceBarItems } from "@/lib/canvas/canvas-resource-references";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// showIndex：按连接顺序给图片标「图1、图2…」，与发送给模型的编号一致；@ 引用模式按引用顺序重新编号，不显示
export function CanvasNodeReferenceBar({ nodeId, nodes, connectedNodes, onDisconnect, onStartSelection, showIndex = false, selfImageNode }: { nodeId: string; nodes: CanvasNodeData[]; connectedNodes: CanvasNodeData[]; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void; showIndex?: boolean; selfImageNode?: CanvasNodeData }) {
    const { t } = useTranslation();
    const theme = useCanvasTheme();
    const references = buildReferenceBarItems(connectedNodes, nodes);
    const imageIndex = new Set(references.flatMap((item) => (item.label ? [item.label] : []))).size;
    return (
        <div className="mb-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.references.title")}</div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {references.map(({ key, node, sourceNodeId, label, imageUrl }) => <ReferenceItem key={key} node={node} imageUrl={imageUrl} label={showIndex ? label : undefined} caption={getNodeDefinition(node.type)?.resource?.(node)?.caption} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} />)}
                {/* 节点自身的图会作为最后一张参考图一起发送 */}
                {selfImageNode ? <ReferenceItem node={selfImageNode} label={imageReferenceLabel(imageIndex)} caption={t("canvas.references.self")} /> : null}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} title={t("canvas.references.select")} onClick={() => onStartSelection?.(nodeId)}>
                    <Plus className="size-4" />
                </button>
            </div>
        </div>
    );
}

// imageUrl：插件多图资源中的单张图，优先于节点自身内容
function ReferenceItem({ node, imageUrl, label, caption, onRemove }: { node: CanvasNodeData; imageUrl?: string; label?: string; caption?: string; onRemove?: () => void }) {
    const { t } = useTranslation();
    const theme = useCanvasTheme();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = imageUrl || node.metadata?.content || resource?.url;
    const thumbnail = imageUrl || previewUrlFor(node.metadata?.storageKey) || content;
    const Icon = resource?.kind === "image" || node.type === CanvasNodeType.Image ? ImageIcon : resource?.kind === "video" || node.type === CanvasNodeType.Video ? Video : resource?.kind === "audio" || node.type === CanvasNodeType.Audio ? Music2 : resource?.kind === "text" || node.type === CanvasNodeType.Text ? FileText : Puzzle;
    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview node={node} content={content} />}>
            <div className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && thumbnail ? <img src={thumbnail} alt="" className="size-full object-cover" /> : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? <video src={content} className="size-full object-cover" muted /> : <Icon className="size-4 opacity-65" />}
                </span>
                {label ? <span className="pointer-events-none absolute left-0.5 top-0.5 whitespace-nowrap rounded-md bg-black/65 px-1 text-[10px] font-medium leading-4 text-white">{label}</span> : null}
                {caption ? <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-xl bg-black/55 text-center text-[9px] leading-3.5 text-white">{caption}</span> : null}
                {onRemove ? <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button> : null}
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
