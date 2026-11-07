import { expect, test } from "bun:test";

import { buildImageNodeOps, getUpstreamImages, getUpstreamText, gridPositions } from "./canvas-utils";
import type { CanvasConnection, CanvasNodeContext, CanvasNodeData, CanvasNodeResource } from "./types";

test("gridPositions lays out row-first with default columns and gap", () => {
    expect(gridPositions({ x: 0, y: 0 }, 4, { width: 100, height: 100 })).toEqual([
        { x: 0, y: 0 },
        { x: 140, y: 0 },
        { x: 0, y: 140 },
        { x: 140, y: 140 },
    ]);
});

test("gridPositions honours an explicit column count", () => {
    const points = gridPositions({ x: 10, y: 20 }, 5, { width: 100, height: 100 }, { columns: 5 });
    expect(points.length).toBe(5);
    expect(points.every((point) => point.y === 20)).toBe(true);
    expect(points[4].x).toBe(10 + 4 * 140);
});

test("buildImageNodeOps adds image nodes and connects them from the source", () => {
    const items = [
        { id: "a", title: "A", dataUrl: "data:image/png;base64,a", width: 1000, height: 500 },
        { id: "b", title: "B", dataUrl: "data:image/jpeg;base64,b", width: 500, height: 1000 },
    ];
    const ops = buildImageNodeOps("s", items, { x: 0, y: 0 });
    const adds = ops.filter((op) => op.type === "add_node");
    const connects = ops.filter((op) => op.type === "connect_nodes");
    expect(adds.length).toBe(2);
    expect(connects.length).toBe(2);
    expect(connects.every((op) => op.type === "connect_nodes" && op.fromNodeId === "s")).toBe(true);
    expect(connects.map((op) => op.type === "connect_nodes" && op.toNodeId)).toEqual(["a", "b"]);
    const first = adds[0];
    if (first.type !== "add_node") throw new Error("unexpected op");
    expect(first.nodeType).toBe("image");
    expect(first.width).toBe(240);
    expect(first.height).toBe(120);
    expect(first.metadata).toMatchObject({ content: items[0].dataUrl, status: "success", naturalWidth: 1000, naturalHeight: 500, mimeType: "image/png" });
    const second = adds[1];
    if (second.type !== "add_node") throw new Error("unexpected op");
    expect(second.metadata?.mimeType).toBe("image/jpeg");
});

function makeCtx(nodes: CanvasNodeData[], connections: CanvasConnection[], selfId: string, resources: Record<string, CanvasNodeResource> = {}): CanvasNodeContext {
    const byId = (id: string) => nodes.find((node) => node.id === id) || null;
    return {
        getResource: (id: string) => resources[id] || null,
        node: byId(selfId)!,
        getNode: byId,
        getNodes: () => nodes,
        getConnections: () => connections,
        getUpstream: () => connections.filter((conn) => conn.toNodeId === selfId).map((conn) => byId(conn.fromNodeId)).filter((node): node is CanvasNodeData => Boolean(node)),
    } as unknown as CanvasNodeContext;
}

const node = (id: string, type: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });

test("getUpstreamImages collects images, group members and plugin resources without duplicates", () => {
    const nodes = [
        node("self", "x:node"),
        node("img1", "image", { content: "u1" }),
        node("grp", "group"),
        node("img2", "image", { content: "u2", groupId: "grp" }),
        node("img3", "image", { content: "u1", groupId: "grp" }),
        node("txt", "text", { content: "hello" }),
        node("plug", "subject:node"),
    ];
    const connections = ["img1", "grp", "txt", "plug"].map((from, index) => ({ id: `c${index}`, fromNodeId: from, toNodeId: "self" }));
    const ctx = makeCtx(nodes, connections, "self", { plug: { kind: "image", urls: ["u3", "u4"] } });
    const images = getUpstreamImages(ctx);
    expect(images).toEqual(["u1", "u2", "u3", "u4"]);
});

test("getUpstreamText joins text nodes and plugin text resources", () => {
    const nodes = [node("self", "x:node"), node("t1", "text", { content: "a" }), node("p", "prompt-assistant:node", { content: "b" }), node("i", "image", { content: "u" })];
    const connections = ["t1", "p", "i"].map((from, index) => ({ id: `c${index}`, fromNodeId: from, toNodeId: "self" }));
    const ctx = makeCtx(nodes, connections, "self", { p: { kind: "text", text: "b" } });
    expect(getUpstreamText(ctx)).toBe("a\n\nb");
});
