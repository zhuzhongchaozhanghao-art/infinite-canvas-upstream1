import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { PluginStoredImage } from "@/types/canvas-plugin";
import { getGroupWrapRect } from "@/lib/canvas/canvas-node-geometry";

export const CHARACTER_IMAGE_LABELS = ["角色立绘", "肖像特写", "表情九宫格", "三视图"] as const;
export type CharacterAsset = { label: string; path: string };
export type CharacterRole = {
    id: string;
    name: string;
    category: string;
    preview: string;
    metadata?: string;
    attributes: Record<string, string>;
    tags: string[];
    files?: { label: string; url: string }[];
    descriptions: { label: string; text: string }[];
};
export type CharacterDetail = CharacterRole & { assets: CharacterAsset[] };

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("characterLibrary.invalidIndex");
    return value as Record<string, unknown>;
}

export function readCharacterIndex(value: unknown): CharacterRole[] {
    const index = record(value);
    if (index.schemaVersion !== 1 || !Array.isArray(index.roles)) throw new Error("characterLibrary.invalidIndex");
    const ids = new Set<string>();
    return index.roles.map((entry) => {
        const role = record(entry);
        if (typeof role.id !== "string" || !role.id || ids.has(role.id) || typeof role.name !== "string" || !role.name.trim() || typeof role.category !== "string" || typeof role.preview !== "string") throw new Error("characterLibrary.invalidIndex");
        if (role.metadata !== undefined && typeof role.metadata !== "string") throw new Error("characterLibrary.invalidIndex");
        ids.add(role.id);
        const attributes = Object.fromEntries(Object.entries(record(role.attributes || {})).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        const files = Array.isArray(role.files)
            ? role.files.map((file) => {
                  const item = record(file);
                  if (typeof item.label !== "string" || typeof item.url !== "string") throw new Error("characterLibrary.invalidIndex");
                  return { label: item.label, url: item.url };
              })
            : undefined;
        return {
            id: role.id,
            name: role.name,
            category: role.category,
            preview: role.preview,
            metadata: role.metadata as string | undefined,
            attributes,
            tags: Array.isArray(role.tags) ? role.tags.filter((tag): tag is string => typeof tag === "string") : [],
            files,
            descriptions: [],
        };
    });
}

export function readCharacterDetail(role: CharacterRole, value?: unknown): CharacterDetail {
    const detail = value === undefined ? role : record(value);
    const localFiles = "localFiles" in detail && Array.isArray(detail.localFiles) ? detail.localFiles : null;
    const files = localFiles || detail.files;
    if (!Array.isArray(files)) throw new Error("characterLibrary.missingImages");
    const prefix = role.metadata?.includes("/") ? role.metadata.slice(0, role.metadata.lastIndexOf("/") + 1) : "";
    const assets = CHARACTER_IMAGE_LABELS.map((label) => {
        const matches = files.filter((file) => record(file).label === label);
        if (matches.length !== 1) throw new Error("characterLibrary.missingImages");
        const file = record(matches[0]);
        const path = localFiles ? file.path : file.url;
        if (typeof path !== "string" || !path) throw new Error("characterLibrary.missingImages");
        return { label, path: localFiles ? prefix + path : path };
    });
    const descriptions = Array.isArray(detail.descriptions)
        ? detail.descriptions.flatMap((value) => {
              const item = record(value);
              return typeof item.label === "string" && typeof item.text === "string" ? [{ label: item.label, text: item.text }] : [];
          })
        : [];
    return { ...role, descriptions, assets };
}

export function filterCharacters(roles: CharacterRole[], keyword: string, category: string, attributes: Record<string, string>) {
    const search = keyword.trim().toLocaleLowerCase();
    return roles.filter(
        (role) =>
            (!category || role.category === category || role.category.startsWith(`${category}·`)) &&
            Object.entries(attributes).every(([key, value]) => !value || role.attributes[key] === value) &&
            (!search || [role.name, role.category, ...role.tags, ...Object.values(role.attributes)].join(" ").toLocaleLowerCase().includes(search)),
    );
}

export function safeCharacterPath(path: string) {
    const parts = path.replaceAll("\\", "/").split("/");
    if (!path || parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) throw new Error("characterLibrary.invalidPath");
    return parts;
}

export function buildCharacterGroup(role: CharacterDetail, images: PluginStoredImage[], nodes: CanvasNodeData[], groupId: string, width: number): CanvasAgentOp[] {
    if (images.length !== 4 || images.some((image) => !image.storageKey || !image.url || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0)) throw new Error("characterLibrary.missingImages");
    const order = [1, 3, 0, 2]; // Portrait + three views above, full body + expression sheet below.
    const gap = 24;
    const startX = nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 96 : 0;
    const rowHeights = [0, 1].map((row) => Math.max(...order.slice(row * 2, row * 2 + 2).map((index) => (width * images[index].height) / images[index].width)));
    const members: CanvasNodeData[] = order.map((index, position) => {
        const image = images[index];
        const height = (width * image.height) / image.width;
        const row = Math.floor(position / 2);
        return {
            id: `${groupId}:${index}`,
            type: "image",
            title: `${role.name} · ${role.assets[index].label}`,
            position: { x: startX + (position % 2) * (width + gap), y: (row ? rowHeights[0] + gap : 0) + (rowHeights[row] - height) / 2 },
            width,
            height,
            metadata: { groupId, content: image.url, storageKey: image.storageKey, mimeType: image.mimeType, bytes: image.bytes, naturalWidth: image.width, naturalHeight: image.height, status: "success" },
        };
    });
    const rect = getGroupWrapRect(members);
    return [
        { type: "add_node", id: groupId, nodeType: "group", title: role.name, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height },
        ...members.map((node): CanvasAgentOp => ({ type: "add_node", id: node.id, nodeType: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata: node.metadata })),
        { type: "select_nodes", ids: [groupId] },
    ];
}
