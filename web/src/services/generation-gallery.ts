import localforage from "localforage";

import { ensureImagePreview, resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";

// 生成画廊：合并画布生成记录与 /image、/video 两个工作台的日志，统一展示。
export type GallerySource = "canvas" | "image-page" | "video-page";

export type GalleryItem = {
    id: string;
    source: GallerySource;
    kind: "image" | "video";
    createdAt: number;
    prompt: string;
    model: string;
    size?: string;
    quality?: string;
    seconds?: string;
    url: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    projectId?: string;
    projectTitle?: string;
    logId?: string; // 工作台日志 id，删除时用来定位
};

export type CanvasGenerationRecord = Omit<GalleryItem, "source" | "url" | "logId">;

const canvasStore = localforage.createInstance({ name: "infinite-canvas", storeName: "canvas_generation_logs" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

type ImageLog = { id: string; createdAt?: number; prompt?: string; model?: string; size?: string; quality?: string; images?: { id: string; dataUrl?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string }[] };
type VideoLog = { id: string; createdAt?: number; prompt?: string; model?: string; size?: string; seconds?: string; status?: string; video?: { id: string; url?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string } };

// 画布生成成功时记一条；以 storageKey 作为 id，重复写入不会产生重复记录。
export async function recordCanvasGeneration(record: CanvasGenerationRecord) {
    await canvasStore.setItem(record.id, record);
}

export async function readGalleryItems(): Promise<GalleryItem[]> {
    const items: GalleryItem[] = [];
    await Promise.all([
        canvasStore.iterate<CanvasGenerationRecord, void>((record) => {
            items.push({ ...record, source: "canvas", url: "" });
        }),
        imageLogStore.iterate<ImageLog, void>((log) => {
            (log.images || []).forEach((image) =>
                items.push({
                    id: `image-page:${log.id}:${image.id}`,
                    source: "image-page",
                    kind: "image",
                    createdAt: log.createdAt || 0,
                    prompt: log.prompt || "",
                    model: log.model || "",
                    size: log.size,
                    quality: log.quality,
                    url: image.storageKey ? "" : image.dataUrl || "",
                    storageKey: image.storageKey,
                    width: image.width,
                    height: image.height,
                    bytes: image.bytes,
                    mimeType: image.mimeType,
                    logId: log.id,
                }),
            );
        }),
        videoLogStore.iterate<VideoLog, void>((log) => {
            if (log.status && log.status !== "success") return;
            if (!log.video) return;
            items.push({
                id: `video-page:${log.id}`,
                source: "video-page",
                kind: "video",
                createdAt: log.createdAt || 0,
                prompt: log.prompt || "",
                model: log.model || "",
                size: log.size,
                seconds: log.seconds,
                url: log.video.storageKey ? "" : log.video.url || "",
                storageKey: log.video.storageKey,
                width: log.video.width,
                height: log.video.height,
                bytes: log.video.bytes,
                mimeType: log.video.mimeType,
                logId: log.id,
            });
        }),
    ]);
    const resolved = await Promise.all(
        items.map(async (item) => {
            if (!item.storageKey) return item;
            if (item.kind === "image") {
                void ensureImagePreview(item.storageKey);
                return { ...item, url: await resolveImageUrl(item.storageKey, item.url) };
            }
            return { ...item, url: await resolveMediaUrl(item.storageKey, item.url) };
        }),
    );
    // 文件已被清理的记录不展示
    return resolved.filter((item) => item.url).sort((a, b) => b.createdAt - a.createdAt);
}

// 只删记录，不删文件：文件可能仍被画布节点或资产引用，孤儿文件由现有清理逻辑回收。
export async function deleteGalleryItem(item: GalleryItem) {
    if (item.source === "canvas") return canvasStore.removeItem(item.id);
    if (item.source === "video-page") return videoLogStore.removeItem(item.logId!);
    const log = await imageLogStore.getItem<ImageLog>(item.logId!);
    if (!log) return;
    const images = (log.images || []).filter((image) => `image-page:${log.id}:${image.id}` !== item.id);
    if (images.length) await imageLogStore.setItem(log.id, { ...log, images });
    else await imageLogStore.removeItem(log.id);
}
