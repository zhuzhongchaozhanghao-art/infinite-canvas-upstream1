import { describe, expect, test } from "bun:test";
import type { CanvasConnection, CanvasNodeData } from "@infinite-canvas/plugin-sdk";
import { captureGroup, instantiateTemplate } from "./logic";
import type { WorkflowTemplate } from "./logic";

// 组 G 在 (100,100),含 a/b/c 三个成员;a→b、b→c 两条组内连线,c→outside 一条连到组外
function fixture() {
    const nodes: CanvasNodeData[] = [
        { id: "G", type: "group", title: "组", position: { x: 100, y: 100 }, width: 600, height: 400, metadata: {} },
        { id: "a", type: "text", title: "文本", position: { x: 150, y: 180 }, width: 200, height: 120, metadata: { groupId: "G", content: "hello", status: "success" } },
        { id: "b", type: "image", title: "图片", position: { x: 400, y: 180 }, width: 240, height: 240, metadata: { groupId: "G", content: "", status: "error", errorDetails: "boom" } },
        { id: "c", type: "video", title: "视频", position: { x: 400, y: 420 }, width: 240, height: 140, metadata: { groupId: "G", status: "loading", videoTaskId: "task-1" } },
        { id: "outside", type: "text", title: "外部", position: { x: 900, y: 100 }, width: 200, height: 120, metadata: {} },
    ];
    const connections: CanvasConnection[] = [
        { id: "c1", fromNodeId: "a", toNodeId: "b" },
        { id: "c2", fromNodeId: "b", toNodeId: "c" },
        { id: "c3", fromNodeId: "c", toNodeId: "outside" },
    ];
    return { nodes, connections };
}

function makeTemplate(): WorkflowTemplate {
    const { nodes, connections } = fixture();
    return { id: "t1", name: "模板", createdAt: 0, ...captureGroup("G", nodes, connections) };
}

describe("captureGroup", () => {
    test("捕获组本身与成员节点,只保留两端都在组内的连线", () => {
        const { nodes, connections } = fixture();
        const captured = captureGroup("G", nodes, connections);
        expect(captured.nodes.map((n) => n.key).sort()).toEqual(["G", "a", "b", "c"]);
        expect(captured.connections).toEqual([
            { from: "a", to: "b" },
            { from: "b", to: "c" },
        ]);
    });

    test("坐标存为相对组左上角的偏移", () => {
        const { nodes, connections } = fixture();
        const captured = captureGroup("G", nodes, connections);
        const a = captured.nodes.find((n) => n.key === "a")!;
        expect(a.dx).toBe(50);
        expect(a.dy).toBe(80);
        const g = captured.nodes.find((n) => n.key === "G")!;
        expect([g.dx, g.dy]).toEqual([0, 0]);
    });

    test("去掉运行态字段:errorDetails、videoTaskId 不存在,status 归位", () => {
        const { nodes, connections } = fixture();
        const captured = captureGroup("G", nodes, connections);
        for (const n of captured.nodes) {
            expect("errorDetails" in n.metadata).toBe(false);
            expect("videoTaskId" in n.metadata).toBe(false);
        }
        const byKey = Object.fromEntries(captured.nodes.map((n) => [n.key, n]));
        expect(byKey.a.metadata.status).toBe("success"); // 有内容的文本节点保留 success
        expect(byKey.b.metadata.status).toBe("idle"); // 无内容的图片节点归 idle
        expect(byKey.c.metadata.status).toBe("idle");
        expect(byKey.G.metadata.status).toBe("idle");
    });

    test("不修改原节点数据", () => {
        const { nodes, connections } = fixture();
        captureGroup("G", nodes, connections);
        expect(nodes[2].metadata?.errorDetails).toBe("boom");
        expect(nodes[3].metadata?.videoTaskId).toBe("task-1");
    });
});

describe("instantiateTemplate", () => {
    test("生成 4 个 add_node + 2 个 connect_nodes,全部新 id,groupId 指向新组", () => {
        let seq = 0;
        const ops = instantiateTemplate(makeTemplate(), { x: 0, y: 0 }, () => `n${++seq}`);
        const adds = ops.filter((op) => op.type === "add_node");
        const links = ops.filter((op) => op.type === "connect_nodes");
        expect(adds.length).toBe(4);
        expect(links.length).toBe(2);
        const oldIds = new Set(["G", "a", "b", "c", "outside"]);
        const newIds = adds.map((op) => (op.type === "add_node" ? op.id! : ""));
        for (const id of newIds) expect(oldIds.has(id)).toBe(false);
        expect(new Set(newIds).size).toBe(4);
        const group = adds.find((op) => op.type === "add_node" && op.nodeType === "group");
        expect(group).toBeDefined();
        const groupNewId = group!.type === "add_node" ? group!.id : "";
        // 组节点排在最前,避免成员被组盖住
        expect(adds[0]).toBe(group!);
        for (const op of adds) {
            if (op.type !== "add_node" || op.nodeType === "group") continue;
            expect(op.metadata?.groupId).toBe(groupNewId);
        }
        for (const op of links) {
            if (op.type !== "connect_nodes") continue;
            expect(newIds).toContain(op.fromNodeId);
            expect(newIds).toContain(op.toNodeId);
        }
    });

    test("按偏移铺回:origin (0,0) 时子节点 a 在 (50,80)", () => {
        let seq = 0;
        const ops = instantiateTemplate(makeTemplate(), { x: 0, y: 0 }, () => `n${++seq}`);
        const a = ops.find((op) => op.type === "add_node" && op.title === "文本");
        expect(a && a.type === "add_node" ? a.position : null).toEqual({ x: 50, y: 80 });
        const g = ops.find((op) => op.type === "add_node" && op.nodeType === "group");
        expect(g && g.type === "add_node" ? [g.position, g.width, g.height] : null).toEqual([{ x: 0, y: 0 }, 600, 400]);
    });

    test("连线按新 id 重建,保持原有方向", () => {
        let seq = 0;
        const ops = instantiateTemplate(makeTemplate(), { x: 10, y: 20 }, () => `n${++seq}`);
        const idByTitle = Object.fromEntries(ops.flatMap((op) => (op.type === "add_node" ? [[op.title, op.id]] : [])));
        const links = ops.flatMap((op) => (op.type === "connect_nodes" ? [[op.fromNodeId, op.toNodeId]] : []));
        expect(links).toEqual([
            [idByTitle["文本"], idByTitle["图片"]],
            [idByTitle["图片"], idByTitle["视频"]],
        ]);
    });
});
