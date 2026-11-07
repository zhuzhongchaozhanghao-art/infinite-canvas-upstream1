// 画布插件共用的纯工具:网格布局、铺图节点指令、读取上游图片/文本。
// 只依赖本 SDK 的公开类型与 ctx 能力,不触碰宿主内部模块。

import type { CanvasAgentOp, CanvasNodeContext, CanvasNodeData, Position } from "./types";

export type GridOptions = { columns?: number; gap?: number };
export type ImageNodeItem = { id: string; title: string; dataUrl: string; width: number; height: number };
export type ImageNodeOpsOptions = GridOptions & { cellWidth?: number };

const DEFAULT_GAP = 40;
const DEFAULT_CELL_WIDTH = 240;

/** 按行优先排列 count 个单元格的左上角坐标;默认列数 ceil(sqrt(count))、间距 40 */
export function gridPositions(origin: Position, count: number, cell: { width: number; height: number }, opts: GridOptions = {}): Position[] {
    if (count <= 0) return [];
    const columns = Math.max(1, Math.floor(opts.columns ?? Math.ceil(Math.sqrt(count))));
    const gap = opts.gap ?? DEFAULT_GAP;
    return Array.from({ length: count }, (_, index) => ({
        x: origin.x + (index % columns) * (cell.width + gap),
        y: origin.y + Math.floor(index / columns) * (cell.height + gap),
    }));
}

/** 生成「新增图片节点 + 从 sourceNodeId 连线」的画布指令;节点宽 cellWidth(默认 240),高按原图比例 */
export function buildImageNodeOps(sourceNodeId: string, items: ImageNodeItem[], origin: Position, opts: ImageNodeOpsOptions = {}): CanvasAgentOp[] {
    const cellWidth = opts.cellWidth ?? DEFAULT_CELL_WIDTH;
    const heights = items.map((item) => Math.round(cellWidth * (item.width > 0 && item.height > 0 ? item.height / item.width : 1)));
    // 行高取最高的一张,避免不同比例的图互相重叠
    const positions = gridPositions(origin, items.length, { width: cellWidth, height: Math.max(0, ...heights) }, opts);
    const adds: CanvasAgentOp[] = items.map((item, index) => ({
        type: "add_node",
        id: item.id,
        nodeType: "image",
        title: item.title,
        position: positions[index],
        width: cellWidth,
        height: heights[index],
        metadata: { content: item.dataUrl, status: "success", naturalWidth: item.width, naturalHeight: item.height, mimeType: mimeTypeOf(item.dataUrl) },
    }));
    const connects: CanvasAgentOp[] = items.map((item) => ({ type: "connect_nodes", fromNodeId: sourceNodeId, toNodeId: item.id }));
    return [...adds, ...connects];
}

/** 上游图片:图片节点 content、插件资源 url/urls,组节点展开为组内成员;按连线顺序去重 */
export function getUpstreamImages(ctx: CanvasNodeContext): string[] {
    const urls = ctx.getUpstream().flatMap((node) => (node.type === "group" ? groupMembers(ctx, node.id) : [node]).flatMap((item) => nodeImages(ctx, item)));
    return [...new Set(urls)];
}

/** 上游文本:文本节点内容与插件 text 资源,以空行连接 */
export function getUpstreamText(ctx: CanvasNodeContext): string {
    return ctx
        .getUpstream()
        .map((node) => {
            if (node.type === "text") return node.metadata?.content || node.metadata?.prompt || "";
            const resource = ctx.getResource?.(node.id);
            return resource?.kind === "text" ? resource.text || "" : "";
        })
        .filter((text) => text.trim())
        .join("\n\n");
}

/** 读取图片的原始像素尺寸(浏览器环境) */
export function readImageSize(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("图片读取失败"));
        image.src = src;
    });
}

function groupMembers(ctx: CanvasNodeContext, groupId: string) {
    return ctx.getNodes().filter((node) => node.metadata?.groupId === groupId);
}

function nodeImages(ctx: CanvasNodeContext, node: CanvasNodeData): string[] {
    if (node.type === "image") return node.metadata?.content ? [node.metadata.content] : [];
    const resource = ctx.getResource?.(node.id);
    if (resource?.kind !== "image") return [];
    return (resource.urls?.length ? resource.urls : resource.url ? [resource.url] : []).filter(Boolean);
}

function mimeTypeOf(dataUrl: string) {
    return dataUrl.match(/^data:([^;,]+)/)?.[1] || "image/png";
}
