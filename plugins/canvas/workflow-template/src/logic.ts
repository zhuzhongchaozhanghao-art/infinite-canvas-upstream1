// 工作流模板的纯逻辑:捕获组 → 模板、模板 → 画布指令。不依赖 DOM,便于单测。
import type { CanvasAgentOp, CanvasConnection, CanvasNodeData } from "@infinite-canvas/plugin-sdk";

export type TemplateNode = { key: string; type: string; title: string; dx: number; dy: number; width: number; height: number; metadata: Record<string, unknown> };

export type WorkflowTemplate = { id: string; name: string; createdAt: number; nodes: TemplateNode[]; connections: { from: string; to: string }[] };

// 插件私有存储里保存模板列表的键
export const STORAGE_KEY = "templates";

// 有内容时可保留 success 状态的节点类型
const CONTENT_TYPES = new Set(["image", "video", "text"]);
// 保存时丢弃的运行态字段
const RUNTIME_FIELDS = ["videoTaskId", "errorDetails"];

// 去掉运行态字段,status 归位为 idle(有内容的图片/视频/文本节点保留 success)
function cleanMetadata(node: CanvasNodeData): Record<string, unknown> {
    const metadata: Record<string, unknown> = { ...(node.metadata || {}) };
    for (const field of RUNTIME_FIELDS) delete metadata[field];
    const hasContent = CONTENT_TYPES.has(node.type) && Boolean(metadata.content);
    metadata.status = hasContent ? "success" : "idle";
    return metadata;
}

// 捕获组:组本身 + metadata.groupId 指向该组的节点 + 两端都在其中的连线;坐标存为相对组左上角的偏移
export function captureGroup(groupId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): Omit<WorkflowTemplate, "id" | "name" | "createdAt"> {
    const group = nodes.find((node) => node.id === groupId);
    if (!group) return { nodes: [], connections: [] };
    const members = [group, ...nodes.filter((node) => node.id !== groupId && node.metadata?.groupId === groupId)];
    const keys = new Set(members.map((node) => node.id));
    return {
        nodes: members.map((node) => ({
            key: node.id,
            type: node.type,
            title: node.title,
            dx: node.position.x - group.position.x,
            dy: node.position.y - group.position.y,
            width: node.width,
            height: node.height,
            metadata: cleanMetadata(node),
        })),
        connections: connections.filter((conn) => keys.has(conn.fromNodeId) && keys.has(conn.toNodeId)).map((conn) => ({ from: conn.fromNodeId, to: conn.toNodeId })),
    };
}

// 实例化模板:全部节点新 id,按偏移铺在 origin 处,groupId 映射到新 id,连线按新 id 重建。
// 组节点排在最前面,保证成员渲染在组之上。
export function instantiateTemplate(t: WorkflowTemplate, origin: { x: number; y: number }, newId: () => string): CanvasAgentOp[] {
    const idMap = new Map<string, string>();
    for (const node of t.nodes) idMap.set(node.key, newId());
    const ordered = [...t.nodes].sort((a, b) => Number(b.type === "group") - Number(a.type === "group"));
    const adds: CanvasAgentOp[] = ordered.map((node) => {
        const metadata: Record<string, unknown> = { ...node.metadata };
        if (typeof metadata.groupId === "string") {
            const mapped = idMap.get(metadata.groupId);
            if (mapped) metadata.groupId = mapped;
            else delete metadata.groupId;
        }
        return {
            type: "add_node",
            id: idMap.get(node.key)!,
            nodeType: node.type,
            title: node.title,
            position: { x: origin.x + node.dx, y: origin.y + node.dy },
            width: node.width,
            height: node.height,
            metadata,
        };
    });
    const links: CanvasAgentOp[] = t.connections.flatMap((conn) => {
        const fromNodeId = idMap.get(conn.from);
        const toNodeId = idMap.get(conn.to);
        return fromNodeId && toNodeId ? [{ type: "connect_nodes" as const, fromNodeId, toNodeId }] : [];
    });
    return [...adds, ...links];
}

// 生成不与画布冲突的随机 id
export function randomId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
