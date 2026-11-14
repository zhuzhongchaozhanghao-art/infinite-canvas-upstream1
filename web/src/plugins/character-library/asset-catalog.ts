import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { PluginStoredImage } from "@/types/canvas-plugin";
import { getGroupWrapRect } from "@/lib/canvas/canvas-node-geometry";

export type AssetKind = "pose" | "costume" | "portrait";
export type AssetFeed = { id: string; name: string; kind: AssetKind; url: string; baseUrl: string; homepage: string; enabled: boolean; builtIn: boolean };
export type ReferenceView = { id: string; label: string; thumbnail: string; original: string; depthThumbnail?: string; depthOriginal?: string };
export type ReferenceAsset = {
    id: string;
    sourceId: string;
    name: string;
    category: string;
    tags: string[];
    keywords: string;
    attributes: Record<string, string>;
    sourceName: string;
    homepage: string;
    sensitive: boolean;
    search: string;
    views: ReferenceView[];
    raw: Record<string, unknown>[];
};

const root = "https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/";
const homepage = "https://github.com/anhao/ai-pose-gallery-zh";
export const DEFAULT_ASSET_FEEDS: AssetFeed[] = [
    { id: "anhao-pose", name: "ギア · 姿势", kind: "pose", url: `${root}data/pose-zh.json`, baseUrl: root, homepage, enabled: true, builtIn: true },
    { id: "anhao-costume", name: "ギア · 现实服装", kind: "costume", url: `${root}data/costume-zh.json`, baseUrl: root, homepage: "https://ai-costume-gallery.pages.dev/", enabled: true, builtIn: true },
    { id: "anhao-costume-anime", name: "ギア · 动漫服装", kind: "costume", url: `${root}data/costume-gia-anime-zh.json`, baseUrl: root, homepage: "https://ai-costume-anime-gallery.pages.dev/", enabled: true, builtIn: true },
    { id: "anhao-charadb", name: "たき AI · CharaDB", kind: "costume", url: `${root}data/costume-anime-zh.json`, baseUrl: root, homepage: "https://github.com/taki-ttt/charadb", enabled: true, builtIn: true },
    { id: "anhao-shisei", name: "Shisei · wquguru", kind: "costume", url: `${root}data/costume-shisei-zh.json`, baseUrl: root, homepage: "https://github.com/wquguru/shisei", enabled: true, builtIn: true },
    { id: "anhao-portrait", name: "ギア · 人像", kind: "portrait", url: `${root}data/portrait-zh.json`, baseUrl: root, homepage: "https://ai-portrait-gallery.pages.dev/", enabled: true, builtIn: true },
];

export function referenceUrl(input: string, base: string) {
    const url = new URL(input, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("assetLibrary.invalidFeed");
    return url.href;
}

export function validateAssetFeeds(value: unknown): AssetFeed[] {
    if (!Array.isArray(value)) throw new Error("assetLibrary.invalidFeed");
    const ids = new Set<string>();
    return value.map((feed: AssetFeed) => {
        if (
            !feed ||
            [feed.id, feed.name, feed.url, feed.baseUrl, feed.homepage].some((v) => typeof v !== "string" || !v.trim()) ||
            !["pose", "costume", "portrait"].includes(feed.kind) ||
            typeof feed.enabled !== "boolean" ||
            typeof feed.builtIn !== "boolean" ||
            ids.has(feed.id)
        )
            throw new Error("assetLibrary.invalidFeed");
        ids.add(feed.id);
        referenceUrl(feed.url, feed.url);
        referenceUrl(feed.baseUrl, feed.baseUrl);
        referenceUrl(feed.homepage, feed.homepage);
        if (!feed.baseUrl.endsWith("/")) throw new Error("assetLibrary.invalidFeed");
        return { ...feed };
    });
}

// The adapter retains the original records, tags, search text and view labels.
// Nothing is inferred from translated titles or silently replaced by generic tags.
export function readReferenceAssets(value: unknown, feed: AssetFeed): ReferenceAsset[] {
    if (!Array.isArray(value)) throw new Error("assetLibrary.invalidFeed");
    const ids = new Set<string>();
    const assets = new Map<string, ReferenceAsset>();
    for (const row of value) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("assetLibrary.invalidFeed");
        const item = row as Record<string, unknown>;
        const text = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : "");
        const id = text("id");
        if (!id || ids.has(id) || !text("原图") || !text("缩略图")) throw new Error("assetLibrary.invalidFeed");
        ids.add(id);
        const attributes = Object.fromEntries((feed.kind === "pose" ? ["体系", "姿势编号", "分类"] : feed.kind === "costume" ? ["一级分类", "分类", "日文名称"] : ["分区", "发长", "发型名称"]).flatMap((key) => (text(key) ? [[key, text(key)]] : [])));
        const tags = Array.isArray(item.标签) ? item.标签.filter((tag): tag is string => typeof tag === "string") : [];
        const name = text(feed.kind === "pose" ? "姿势名称" : feed.kind === "costume" ? "服装名称" : "标题");
        if (!name) throw new Error("assetLibrary.invalidFeed");
        const groupKey = feed.kind === "pose" ? `${text("体系")}|${text("姿势编号") || id}` : id;
        const category = feed.kind === "pose" ? `${text("体系")}·${text("分类")}` : text(feed.kind === "costume" ? "分类" : "分区");
        const views = feed.kind === "costume" && Array.isArray(item.views) && item.views.length ? item.views : [{ id, label: text("角度") || name, 缩略图: text("缩略图"), 原图: text("原图") }];
        const resolved = views.map((view): ReferenceView => {
            if (!view || typeof view !== "object" || typeof view.id !== "string" || typeof view.label !== "string" || typeof view.缩略图 !== "string" || typeof view.原图 !== "string") throw new Error("assetLibrary.invalidFeed");
            const depth = (path: string, prefix: string) => (path.startsWith(prefix) ? referenceUrl(path.replace(prefix, `${prefix}depth/`).replace(/\.(png|jpe?g)$/i, ".webp"), feed.baseUrl) : undefined);
            return {
                id: view.id,
                label: view.label,
                thumbnail: referenceUrl(view.缩略图, feed.baseUrl),
                original: referenceUrl(view.原图, feed.baseUrl),
                depthThumbnail: feed.kind === "pose" ? depth(view.缩略图, "thumbs/") : undefined,
                depthOriginal: feed.kind === "pose" ? depth(view.原图, "img/") : undefined,
            };
        });
        if (new Set(resolved.map((view) => view.id)).size !== resolved.length) throw new Error("assetLibrary.invalidFeed");
        const sensitive = Boolean(item.敏感) || (feed.kind === "pose" ? ["全身单人・性感系", "双人缠绵"].includes(text("体系")) : feed.kind === "costume" && ["内衣・睡衣", "性感穿搭"].includes(category));
        const existing = assets.get(groupKey);
        if (existing) {
            existing.views.push(...resolved);
            existing.tags = [...new Set([...existing.tags, ...tags])];
            existing.search += ` ${Object.values(item)
                .filter((v) => typeof v === "string")
                .join(" ")} ${tags.join(" ")}`;
            existing.raw.push(item);
        } else
            assets.set(groupKey, {
                id: groupKey,
                sourceId: feed.id,
                name,
                category,
                tags,
                keywords: text("关键词"),
                attributes,
                sourceName: text("来源") || feed.name,
                homepage: referenceUrl(text("来源地址") || feed.homepage, feed.baseUrl),
                sensitive,
                search: `${Object.values(item)
                    .filter((v) => typeof v === "string")
                    .join(" ")} ${tags.join(" ")} ${feed.name}`,
                views: resolved,
                raw: [item],
            });
    }
    return [...assets.values()];
}

export function filterReferenceAssets(items: ReferenceAsset[], keyword: string, category: string, tag: string, source: string, showSensitive: boolean) {
    const terms = keyword.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(
        (item) =>
            (!category || item.category === category) &&
            (!tag || item.tags.includes(tag) || Object.values(item.attributes).includes(tag)) &&
            (!source || item.sourceId === source) &&
            (showSensitive || !item.sensitive) &&
            terms.every((term) => item.search.toLocaleLowerCase().includes(term)),
    );
}

export function buildReferenceNodes(item: ReferenceAsset, views: ReferenceView[], images: PluginStoredImage[], nodes: CanvasNodeData[], id: string, width: number, depth: boolean): CanvasAgentOp[] {
    if (!images.length || images.length !== views.length || images.some((image) => !image.storageKey || !image.url || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0))
        throw new Error("assetLibrary.importFailed");
    const group = images.length > 1;
    const startX = nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 96 : 0;
    const maxHeight = Math.max(...images.map((image) => (width * image.height) / image.width));
    const assetReference = {
        sourceId: item.sourceId,
        itemId: item.id,
        sourceName: item.sourceName,
        homepage: item.homepage,
        tags: item.tags,
        keywords: item.keywords,
        attributes: item.attributes,
        originals: views.map((view) => ({ label: view.label, url: depth ? view.depthOriginal! : view.original })),
        depth,
    };
    const members: CanvasNodeData[] = images.map((image, index) => ({
        id: group ? `${id}:${index}` : id,
        type: "image",
        title: `${item.name} · ${views[index].label}`,
        position: { x: startX + (index % 2) * (width + 24), y: Math.floor(index / 2) * (maxHeight + 24) },
        width,
        height: (width * image.height) / image.width,
        metadata: { ...(group ? { groupId: id } : {}), content: image.url, storageKey: image.storageKey, mimeType: image.mimeType, bytes: image.bytes, naturalWidth: image.width, naturalHeight: image.height, status: "success", assetReference },
    }));
    const rect = getGroupWrapRect(members);
    return [
        ...(group ? [{ type: "add_node" as const, id, nodeType: "group", title: item.name, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height, metadata: { assetReference } }] : []),
        ...members.map((node): CanvasAgentOp => ({ type: "add_node", id: node.id, nodeType: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata: node.metadata })),
        { type: "select_nodes", ids: [id] },
    ];
}
