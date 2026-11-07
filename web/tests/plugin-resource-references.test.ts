import { afterAll, expect, test } from "bun:test";
import type { CanvasConnection, CanvasNodeData } from "../src/types/canvas";
import type { CanvasNodeResource } from "../src/types/canvas-plugin";

// i18n 初始化时会读取 localStorage
const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { registerNodeDefinitions } = await import("../src/lib/canvas/node-registry");
const { buildNodeMentionReferences } = await import("../src/lib/canvas/canvas-resource-references");
const { buildNodeGenerationContext } = await import("../src/components/canvas/canvas-node-generation");
const { CanvasNodeType } = await import("../src/types/canvas");

// 测试用插件节点：资源直接取 metadata.resource
registerNodeDefinitions(
    [{ type: "test-plugin:node", title: "Test", icon: "T", defaultSize: { width: 100, height: 100 }, resource: (node) => (node.metadata?.resource as CanvasNodeResource) || null }],
    "test-plugin",
);

function setup(resource: CanvasNodeResource) {
    const source: CanvasNodeData = { id: "p", type: "test-plugin:node", title: "主体", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { resource } };
    const target: CanvasNodeData = { id: "t", type: CanvasNodeType.Image, title: "目标", position: { x: 200, y: 0 }, width: 100, height: 100, metadata: {} };
    const nodes = [source, target];
    const connections: CanvasConnection[] = [{ id: "c", fromNodeId: "p", toNodeId: "t" }];
    return { nodes, connections, target };
}

test("plugin resource urls expand into numbered image references", () => {
    const { nodes, connections, target } = setup({ kind: "image", urls: ["data:image/png;base64,a", "data:image/png;base64,b"] });
    const refs = buildNodeMentionReferences(target, nodes, connections);
    expect(refs.map((ref) => ref.kind)).toEqual(["image", "image"]);
    expect(refs.map((ref) => ref.label)).toEqual(["图1", "图2"]);
    expect(refs.map((ref) => ref.id)).toEqual(["p#0", "p#1"]);
    expect(refs.every((ref) => ref.nodeId === "p")).toBe(true);
    expect(refs.map((ref) => ref.previewUrl)).toEqual(["data:image/png;base64,a", "data:image/png;base64,b"]);
});

test("plugin resource urls with text add one text reference", () => {
    const { nodes, connections, target } = setup({ kind: "image", urls: ["data:image/png;base64,a", "data:image/png;base64,b"], text: "t" });
    const refs = buildNodeMentionReferences(target, nodes, connections);
    expect(refs.map((ref) => ref.kind)).toEqual(["image", "image", "text"]);
    expect(refs[2].id).toBe("p#text");
    expect(refs[2].text).toBe("t");
});

test("plugin resource with a single url keeps one reference", () => {
    const { nodes, connections, target } = setup({ kind: "image", url: "data:image/png;base64,a" });
    const refs = buildNodeMentionReferences(target, nodes, connections);
    expect(refs.length).toBe(1);
    expect(refs[0].id).toBe("p");
    expect(refs[0].label).toBe("图1");
    expect(refs[0].previewUrl).toBe("data:image/png;base64,a");
});

test("generation context sends every plugin resource image and its text", () => {
    const { nodes, connections } = setup({ kind: "image", urls: ["data:image/png;base64,a", "data:image/jpeg;base64,b"], text: "主体：描述" });
    const context = buildNodeGenerationContext("t", nodes, connections, "生成");
    expect(context.referenceImages.map((image) => image.dataUrl)).toEqual(["data:image/png;base64,a", "data:image/jpeg;base64,b"]);
    expect(context.referenceImages.map((image) => image.type)).toEqual(["image/png", "image/jpeg"]);
    expect(context.prompt).toContain("主体：描述");
});

test("generation context keeps a single-url plugin resource unchanged", () => {
    const { nodes, connections } = setup({ kind: "image", url: "data:image/png;base64,a" });
    const context = buildNodeGenerationContext("t", nodes, connections, "生成");
    expect(context.referenceImages.length).toBe(1);
    expect(context.referenceImages[0].id).toBe("p");
});

test("reference bar expands plugin multi-image resources and keeps numbering continuous", async () => {
    const { buildReferenceBarItems } = await import("../src/lib/canvas/canvas-resource-references");
    const { nodes, target } = setup({ kind: "image", urls: ["data:image/png;base64,a", "data:image/png;base64,b"] });
    const image: CanvasNodeData = { id: "i", type: CanvasNodeType.Image, title: "图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "data:image/png;base64,c" } };
    const items = buildReferenceBarItems([nodes[0], image], [...nodes, image]);
    expect(items.map((item) => item.key)).toEqual(["p:p#0", "p:p#1", "i:i"]);
    expect(items.map((item) => item.label)).toEqual(["图1", "图2", "图3"]);
    expect(items.map((item) => item.imageUrl)).toEqual(["data:image/png;base64,a", "data:image/png;base64,b", undefined]);
    expect(items.every((item) => item.node.id !== target.id)).toBe(true);
});
