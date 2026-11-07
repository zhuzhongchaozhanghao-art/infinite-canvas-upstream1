import { useEffect, useRef } from "react";

import { recordCanvasGeneration } from "@/services/generation-gallery";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// 监听节点状态，把图片/视频节点从 loading 变为 success 的结果记进生成画廊。
// 画布有多处生成入口，统一在状态层面捕获，避免逐个入口埋点；上传、裁剪等不经过 loading 的操作不会被记录。
export function useGenerationRecorder(projectId: string, projectTitle: string | undefined, nodes: CanvasNodeData[]) {
    const pendingRef = useRef(new Set<string>());
    const projectRef = useRef(projectId);

    useEffect(() => {
        if (projectRef.current !== projectId) {
            projectRef.current = projectId;
            pendingRef.current = new Set();
        }
        const pending = pendingRef.current;
        for (const node of nodes) {
            if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) continue;
            const meta = node.metadata || {};
            const track = (key: string, status: string | undefined, media: { storageKey?: string; naturalWidth?: number; naturalHeight?: number; bytes?: number; mimeType?: string }) => {
                if (status === "loading") {
                    pending.add(key);
                    return;
                }
                if (!pending.has(key)) return;
                pending.delete(key);
                if (status !== "success" || !media.storageKey) return;
                void recordCanvasGeneration({
                    id: media.storageKey,
                    kind: node.type === CanvasNodeType.Video ? "video" : "image",
                    createdAt: Date.now(),
                    prompt: meta.prompt || "",
                    model: meta.model || "",
                    size: meta.size,
                    quality: meta.quality,
                    seconds: meta.seconds,
                    storageKey: media.storageKey,
                    width: media.naturalWidth,
                    height: media.naturalHeight,
                    bytes: media.bytes,
                    mimeType: media.mimeType,
                    projectId,
                    projectTitle,
                });
            };
            // 多图节点按单张图跟踪，单图/视频节点按节点跟踪
            if (meta.images?.length) meta.images.forEach((image) => track(`${node.id}/${image.id}`, image.status, image));
            else track(node.id, meta.status, meta);
        }
    }, [nodes, projectId, projectTitle]);
}
