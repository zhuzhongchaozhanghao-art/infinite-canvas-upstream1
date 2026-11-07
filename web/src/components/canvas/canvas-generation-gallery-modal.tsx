import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { App, Button, Empty, Input, Modal, Popconfirm, Segmented, Select, Spin } from "antd";
import { Copy, Download, FolderPlus, ImagePlus, RefreshCw, Search, SlidersHorizontal, Trash2, Video } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { useCanvasTheme } from "@/hooks/use-canvas-theme";
import { deleteGalleryItem, readGalleryItems, type GalleryItem, type GallerySource } from "@/services/generation-gallery";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";

type KindFilter = "all" | "image" | "video";
type TimeFilter = "all" | "today" | "7d" | "30d";

const DAY = 24 * 60 * 60 * 1000;

function timeLowerBound(filter: TimeFilter) {
    if (filter === "today") return new Date().setHours(0, 0, 0, 0);
    if (filter === "7d") return Date.now() - 7 * DAY;
    if (filter === "30d") return Date.now() - 30 * DAY;
    return 0;
}

// 模型值可能带渠道前缀（channel::model），展示时只保留模型名
function modelLabel(model: string) {
    return model.split("::").pop() || model;
}

function fileExtension(item: GalleryItem) {
    const subtype = item.mimeType?.split("/")[1];
    return subtype ? subtype.replace("jpeg", "jpg") : item.kind === "video" ? "mp4" : "png";
}

export function CanvasGenerationGalleryModal({ open, onClose, onInsert, onReuse }: { open: boolean; onClose: () => void; onInsert: (payload: InsertAssetPayload) => void; onReuse: (item: GalleryItem) => void }) {
    const { t, i18n } = useTranslation();
    const theme = useCanvasTheme();
    const { message } = App.useApp();
    const addAsset = useAssetStore((state) => state.addAsset);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [kind, setKind] = useState<KindFilter>("all");
    const [source, setSource] = useState<GallerySource | "all">("all");
    const [model, setModel] = useState<string>("all");
    const [time, setTime] = useState<TimeFilter>("all");
    const [keyword, setKeyword] = useState("");
    const [active, setActive] = useState<GalleryItem | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setItems(await readGalleryItems());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) void refresh();
    }, [open, refresh]);

    const models = useMemo(() => Array.from(new Set(items.map((item) => item.model).filter(Boolean))).sort(), [items]);
    const filtered = useMemo(() => {
        const since = timeLowerBound(time);
        const query = keyword.trim().toLowerCase();
        return items.filter(
            (item) =>
                (kind === "all" || item.kind === kind) &&
                (source === "all" || item.source === source) &&
                (model === "all" || item.model === model) &&
                item.createdAt >= since &&
                (!query || item.prompt.toLowerCase().includes(query) || item.projectTitle?.toLowerCase().includes(query)),
        );
    }, [items, kind, source, model, time, keyword]);

    const sourceLabel = (item: GalleryItem) => (item.source === "canvas" ? item.projectTitle || t("canvas.gallery.sourceCanvas") : t(item.source === "image-page" ? "canvas.gallery.sourceImagePage" : "canvas.gallery.sourceVideoPage"));
    const formatTime = (value: number) => new Date(value).toLocaleString(i18n.resolvedLanguage, { hour12: false });

    const handleInsert = (item: GalleryItem) => {
        const title = item.prompt.slice(0, 32) || t(item.kind === "video" ? "canvas.gallery.video" : "canvas.gallery.image");
        onInsert(item.kind === "video" ? { kind: "video", url: item.url, title, storageKey: item.storageKey, width: item.width, height: item.height } : { kind: "image", dataUrl: item.url, title, storageKey: item.storageKey });
        setActive(null);
        onClose();
    };

    const handleReuse = (item: GalleryItem) => {
        onReuse(item);
        setActive(null);
        onClose();
    };

    const handleSaveAsset = (item: GalleryItem) => {
        const base = { title: item.prompt.slice(0, 32) || t(item.kind === "video" ? "canvas.gallery.video" : "canvas.gallery.image"), tags: [], source: t("canvas.gallery.title"), metadata: { source: "gallery", prompt: item.prompt, model: item.model } };
        const media = { storageKey: item.storageKey, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.mimeType || "" };
        if (item.kind === "video") addAsset({ ...base, kind: "video", coverUrl: "", data: { url: item.url, ...media } });
        else addAsset({ ...base, kind: "image", coverUrl: item.url, data: { dataUrl: item.url, ...media } });
        message.success(t("common.addedToAssets"));
    };

    const handleDelete = async (item: GalleryItem) => {
        await deleteGalleryItem(item);
        setItems((value) => value.filter((entry) => entry.id !== item.id));
        setActive(null);
        message.success(t("canvas.gallery.deleted"));
    };

    const thumbnail = (item: GalleryItem) =>
        item.kind === "video" ? (
            <video src={item.url} muted preload="metadata" className="block w-full" />
        ) : (
            <img src={previewUrlFor(item.storageKey) || item.url} alt={item.prompt} loading="lazy" className="block w-full" />
        );

    const metaRow = (label: string, value?: string) =>
        value ? (
            <div className="flex gap-3 text-xs leading-5">
                <span className="w-14 shrink-0" style={{ color: theme.node.muted }}>
                    {label}
                </span>
                <span className="min-w-0 break-all" style={{ color: theme.node.text }}>
                    {value}
                </span>
            </div>
        ) : null;

    return (
        <>
            <Modal title={t("canvas.gallery.title")} open={open} onCancel={onClose} footer={null} centered width="min(1280px, 94vw)">
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Segmented
                            value={kind}
                            onChange={(value) => setKind(value as KindFilter)}
                            options={[
                                { value: "all", label: t("canvas.gallery.all") },
                                { value: "image", label: t("canvas.gallery.image") },
                                { value: "video", label: t("canvas.gallery.video") },
                            ]}
                        />
                        <Select
                            className="w-32"
                            value={source}
                            onChange={setSource}
                            options={[
                                { value: "all", label: t("canvas.gallery.allSources") },
                                { value: "canvas", label: t("canvas.gallery.sourceCanvas") },
                                { value: "image-page", label: t("canvas.gallery.sourceImagePage") },
                                { value: "video-page", label: t("canvas.gallery.sourceVideoPage") },
                            ]}
                        />
                        <Select className="w-44" value={model} onChange={setModel} popupMatchSelectWidth={false} options={[{ value: "all", label: t("canvas.gallery.allModels") }, ...models.map((value) => ({ value, label: modelLabel(value) }))]} />
                        <Select
                            className="w-28"
                            value={time}
                            onChange={setTime}
                            options={[
                                { value: "all", label: t("canvas.gallery.anyTime") },
                                { value: "today", label: t("canvas.gallery.today") },
                                { value: "7d", label: t("canvas.gallery.last7") },
                                { value: "30d", label: t("canvas.gallery.last30") },
                            ]}
                        />
                        <Input className="min-w-40 flex-1" prefix={<Search className="size-4 opacity-50" />} placeholder={t("canvas.gallery.searchPlaceholder")} value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear />
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {t("canvas.gallery.count", { count: filtered.length })}
                        </span>
                        <Button type="text" icon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />} onClick={refresh} disabled={loading} title={t("canvas.plugins.refresh")} />
                    </div>
                    <div className="thin-scrollbar h-[68vh] overflow-auto pr-1">
                        {loading && items.length === 0 ? (
                            <div className="grid h-full place-items-center">
                                <Spin />
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="grid h-full place-items-center">
                                <Empty description={t("canvas.gallery.empty")} />
                            </div>
                        ) : (
                            <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
                                {filtered.map((item) => (
                                    <button key={item.id} type="button" className="group relative mb-3 block w-full cursor-pointer overflow-hidden rounded-xl border text-left [break-inside:avoid]" style={{ borderColor: theme.node.stroke, background: theme.node.fill }} onClick={() => setActive(item)}>
                                        {thumbnail(item)}
                                        {item.kind === "video" ? (
                                            <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-md bg-black/55 text-white">
                                                <Video className="size-3.5" />
                                            </span>
                                        ) : null}
                                        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6 text-[11px] leading-4 text-white opacity-0 transition group-hover:opacity-100">
                                            <div className="line-clamp-2">{item.prompt || t("canvas.gallery.noPrompt")}</div>
                                            <div className="mt-1 truncate opacity-70">{modelLabel(item.model)}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Modal>

            <Modal open={Boolean(active)} onCancel={() => setActive(null)} footer={null} centered width="min(1100px, 92vw)" title={active ? sourceLabel(active) : ""}>
                {active ? (
                    <div className="flex flex-col gap-4 md:flex-row">
                        <div className="grid min-h-[50vh] flex-1 place-items-center overflow-hidden rounded-xl" style={{ background: theme.node.fill }}>
                            {active.kind === "video" ? <video src={active.url} controls autoPlay className="max-h-[72vh] max-w-full" /> : <img src={active.url} alt={active.prompt} className="max-h-[72vh] max-w-full object-contain" />}
                        </div>
                        <div className="flex w-full shrink-0 flex-col gap-3 md:w-80">
                            <div className="thin-scrollbar max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                                {active.prompt || t("canvas.gallery.noPrompt")}
                            </div>
                            <div className="space-y-1">
                                {metaRow(t("canvas.gallery.model"), modelLabel(active.model))}
                                {metaRow(t("canvas.gallery.size"), active.width && active.height ? `${active.width} × ${active.height}${active.size ? ` · ${active.size}` : ""}` : active.size)}
                                {metaRow(t("canvas.gallery.quality"), active.quality)}
                                {metaRow(t("canvas.gallery.seconds"), active.seconds)}
                                {metaRow(t("canvas.gallery.source"), sourceLabel(active))}
                                {metaRow(t("canvas.gallery.time"), formatTime(active.createdAt))}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <Button type="primary" icon={<ImagePlus className="size-4" />} onClick={() => handleInsert(active)}>
                                    {t("canvas.gallery.insert")}
                                </Button>
                                <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => handleReuse(active)}>
                                    {t("canvas.gallery.reuse")}
                                </Button>
                                <Button icon={<Copy className="size-4" />} disabled={!active.prompt} onClick={() => void navigator.clipboard.writeText(active.prompt).then(() => message.success(t("canvas.gallery.copied")))}>
                                    {t("canvas.gallery.copyPrompt")}
                                </Button>
                                <Button icon={<Download className="size-4" />} onClick={() => saveAs(active.url, `${active.kind}-${active.createdAt}.${fileExtension(active)}`)}>
                                    {t("canvas.gallery.download")}
                                </Button>
                                <Button icon={<FolderPlus className="size-4" />} onClick={() => handleSaveAsset(active)}>
                                    {t("canvas.gallery.saveAsset")}
                                </Button>
                                <Popconfirm title={t("canvas.gallery.deleteTitle")} okText={t("canvas.gallery.delete")} cancelText={t("canvas.editors.cancel")} onConfirm={() => handleDelete(active)}>
                                    <Button danger icon={<Trash2 className="size-4" />}>
                                        {t("canvas.gallery.delete")}
                                    </Button>
                                </Popconfirm>
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </>
    );
}
