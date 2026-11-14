import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Card, Checkbox, Empty, Input, Modal, Pagination, Radio, Select, Spin, Switch, Tag } from "antd";
import { RefreshCw, Search, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { PROMPT_PAGE_SIZE } from "@/components/prompts/use-prompt-list";
import { useAssetSourceStore } from "@/stores/use-asset-source-store";
import { useConfigStore } from "@/stores/use-config-store";
import { loadAssetFeed, fetchReferenceImage } from "@/services/api/asset-library";
import { deleteStoredImages } from "@/services/image-storage";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasPluginHost, PluginStoredImage } from "@/types/canvas-plugin";
import { focusViewportForNode } from "@/lib/canvas/canvas-node-geometry";
import { buildReferenceNodes, filterReferenceAssets, type AssetKind, type ReferenceAsset } from "./asset-catalog";

export function OnlineAssets({ kind, host, onClose }: { kind: AssetKind; host: CanvasPluginHost; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const allSources = useAssetSourceStore((s) => s.sources);
    const sources = useMemo(() => allSources.filter((s) => s.enabled && s.kind === kind), [allSources, kind]);
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("");
    const [tag, setTag] = useState("");
    const [sourceId, setSourceId] = useState("");
    const [showSensitive, setShowSensitive] = useState(false);
    const [page, setPage] = useState(1);
    const [detail, setDetail] = useState<ReferenceAsset | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [depth, setDepth] = useState(false);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);
    const operation = useRef<AbortController | null>(null);
    const guard = useRef(false);
    useEffect(() => () => operation.current?.abort(), []);
    const query = useQuery({
        queryKey: ["asset-library", kind, sources, refresh],
        queryFn: async ({ signal }) =>
            Promise.all(
                sources.map(async (source) => {
                    try {
                        return { source, result: await loadAssetFeed(source, refresh > 0, signal), failed: false };
                    } catch (value) {
                        if (signal.aborted) throw value;
                        return { source, result: null, failed: true };
                    }
                }),
            ),
        staleTime: Infinity,
    });
    const items = useMemo(() => query.data?.flatMap((value) => value.result?.items || []) || [], [query.data]);
    const visible = useMemo(() => filterReferenceAssets(items, "", "", "", sourceId, showSensitive), [items, sourceId, showSensitive]);
    const categories = useMemo(() => [...new Set(visible.map((item) => item.category))], [visible]);
    const tags = useMemo(() => [...new Set(visible.filter((item) => !category || item.category === category).flatMap((item) => [...item.tags, ...Object.values(item.attributes)]))], [visible, category]);
    const filtered = useMemo(() => filterReferenceAssets(items, keyword, category, tag, sourceId, showSensitive), [items, keyword, category, tag, sourceId, showSensitive]);
    const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PROMPT_PAGE_SIZE)));
    const open = (item: ReferenceAsset) => {
        setDetail(item);
        setSelected([item.views[0].id]);
        setDepth(false);
        setError("");
    };
    const apply = async () => {
        if (!detail || !host.media || guard.current) return;
        const views = detail.views.filter((view) => selected.includes(view.id));
        if (!views.length || (depth && views.some((view) => !view.depthOriginal))) return;
        guard.current = true;
        setImporting(true);
        setProgress(0);
        setError("");
        const controller = new AbortController();
        operation.current = controller;
        const images: PluginStoredImage[] = [];
        let committed = false;
        try {
            for (const view of views) {
                const blob = await fetchReferenceImage(depth ? view.depthOriginal! : view.original, controller.signal);
                controller.signal.throwIfAborted();
                const url = URL.createObjectURL(blob);
                try {
                    images.push(await host.media.saveImage(url, controller.signal));
                } finally {
                    URL.revokeObjectURL(url);
                }
                setProgress(images.length);
            }
            controller.signal.throwIfAborted();
            const ops = buildReferenceNodes(detail, views, images, host.getNodes(), nanoid(), NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, depth);
            const first = ops[0];
            if (first.type !== "add_node" || !first.position || !first.width || !first.height) throw new Error("assetLibrary.importFailed");
            host.applyOps([...ops, { type: "set_viewport", viewport: focusViewportForNode({ position: first.position, width: first.width, height: first.height }, { width: window.innerWidth, height: window.innerHeight }) }]);
            committed = true;
            message.success(t("assetLibrary.inserted"));
            onClose();
        } catch {
            if (!controller.signal.aborted) setError(t("assetLibrary.importFailed"));
        } finally {
            if (!committed) await deleteStoredImages(images.map((image) => image.storageKey)).catch(console.error);
            guard.current = false;
            setImporting(false);
        }
    };
    return (
        <div className="flex h-full min-h-0 flex-col gap-3" data-canvas-no-zoom onWheelCapture={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    className="min-w-48 flex-1"
                    allowClear
                    prefix={<Search className="size-4" />}
                    placeholder={t("assetLibrary.search")}
                    value={keyword}
                    onChange={(e) => {
                        setKeyword(e.target.value);
                        setPage(1);
                    }}
                />
                <Button type="text" loading={query.isFetching} icon={<RefreshCw className="size-4" />} onClick={() => setRefresh((v) => v + 1)}>
                    {t("assetLibrary.refresh")}
                </Button>
                <Button type="text" icon={<Settings2 className="size-4" />} onClick={() => useConfigStore.getState().openConfigDialog(false, "asset-sources")}>
                    {t("assetLibrary.sources")}
                </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    className="min-w-36"
                    aria-label={t("assetLibrary.sourceName")}
                    value={sourceId}
                    options={[{ value: "", label: t("assetLibrary.allSources") }, ...sources.map((s) => ({ value: s.id, label: s.name }))]}
                    onChange={(v) => {
                        setSourceId(v);
                        setCategory("");
                        setTag("");
                        setPage(1);
                    }}
                />
                <Select
                    showSearch
                    className="min-w-32"
                    aria-label={t("assetLibrary.category")}
                    value={category}
                    options={[{ value: "", label: t("assetLibrary.allCategories") }, ...categories.map((v) => ({ value: v, label: v }))]}
                    onChange={(v) => {
                        setCategory(v);
                        setTag("");
                        setPage(1);
                    }}
                />
                <Select
                    showSearch
                    className="min-w-44"
                    aria-label={t("assetLibrary.tags")}
                    value={tag}
                    options={[{ value: "", label: t("assetLibrary.allTags") }, ...tags.map((v) => ({ value: v, label: v }))]}
                    onChange={(v) => {
                        setTag(v);
                        setPage(1);
                    }}
                />
                <Button
                    type="text"
                    onClick={() => {
                        setKeyword("");
                        setSourceId("");
                        setCategory("");
                        setTag("");
                        setPage(1);
                    }}
                >
                    {t("characterLibrary.reset")}
                </Button>
                <label className="ml-auto flex items-center gap-2 text-xs">
                    <Switch
                        size="small"
                        checked={showSensitive}
                        onChange={(v) => {
                            setShowSensitive(v);
                            setCategory("");
                            setTag("");
                            setPage(1);
                        }}
                    />
                    {t("assetLibrary.showSensitive")}
                </label>
            </div>
            {query.data
                ?.filter((r) => r.failed || r.result?.stale)
                .map((r) => (
                    <Alert
                        key={r.source.id}
                        type="warning"
                        showIcon
                        message={t(r.result?.stale ? "assetLibrary.cached" : "assetLibrary.sourceFailed", { name: r.source.name })}
                        action={
                            <Button type="text" size="small" icon={<RefreshCw className="size-3" />} onClick={() => setRefresh((v) => v + 1)}>
                                {t("assetLibrary.retry")}
                            </Button>
                        }
                    />
                ))}
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
                <Spin spinning={query.isFetching}>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {filtered.slice((currentPage - 1) * PROMPT_PAGE_SIZE, currentPage * PROMPT_PAGE_SIZE).map((item) => (
                            <Card key={`${item.sourceId}:${item.id}`} hoverable styles={{ body: { padding: 0 } }} className="overflow-hidden">
                                <button className="block w-full text-left" type="button" onClick={() => open(item)}>
                                    <img className="aspect-[3/4] w-full object-contain" src={item.views[0].thumbnail} alt={item.name} loading="lazy" />
                                    <div className="space-y-2 p-3">
                                        <div className="line-clamp-2 text-sm font-semibold">{item.name}</div>
                                        <div className="text-xs opacity-55">
                                            {item.sourceName} · {item.category}
                                        </div>
                                        <div className="flex flex-wrap gap-y-1">
                                            {item.tags.map((value, index) => (
                                                <Tag key={`${value}:${index}`}>{value}</Tag>
                                            ))}
                                        </div>
                                        <div className="line-clamp-2 break-words text-xs opacity-55">{item.keywords}</div>
                                    </div>
                                </button>
                            </Card>
                        ))}
                    </div>
                    {!query.isFetching && !filtered.length ? <Empty description={t("assetLibrary.empty")} /> : null}
                </Spin>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs opacity-55">{t("assetLibrary.count", { count: filtered.length })}</span>
                <Pagination size="small" current={currentPage} pageSize={PROMPT_PAGE_SIZE} total={filtered.length} showSizeChanger={false} hideOnSinglePage onChange={setPage} />
            </div>
            <Modal
                open={Boolean(detail)}
                title={detail?.name}
                onCancel={() => {
                    if (!importing) setDetail(null);
                }}
                maskClosable={!importing}
                closable={!importing}
                footer={null}
                centered
                width="min(1100px,94vw)"
                styles={{ body: { maxHeight: "76dvh", overflowY: "auto" } }}
            >
                {detail ? (
                    <div className="space-y-4" data-canvas-no-zoom>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <a href={detail.homepage} target="_blank" rel="noreferrer" className="text-sm">
                                {detail.sourceName}
                            </a>
                            {kind === "pose" ? (
                                <Radio.Group
                                    value={depth}
                                    disabled={importing}
                                    onChange={(e) => setDepth(e.target.value)}
                                    options={[
                                        { value: false, label: t("assetLibrary.mannequin") },
                                        { value: true, label: t("assetLibrary.depth"), disabled: detail.views.some((v) => !v.depthOriginal) },
                                    ]}
                                />
                            ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {detail.views.map((view) => (
                                <label key={view.id} className="space-y-2">
                                    <img src={depth ? view.depthOriginal : view.original} alt={view.label} className="h-[36vh] w-full object-contain" loading="lazy" />
                                    <Checkbox disabled={importing} checked={selected.includes(view.id)} onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, view.id] : ids.filter((id) => id !== view.id)))}>
                                        {view.label}
                                    </Checkbox>
                                </label>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-y-1">
                            {detail.tags.map((value, index) => (
                                <Tag key={`${value}:${index}`}>{value}</Tag>
                            ))}
                        </div>
                        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                            {Object.entries(detail.attributes).map(([key, value]) => (
                                <div key={key}>
                                    <dt className="inline opacity-55">{key} · </dt>
                                    <dd className="inline">{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {detail.keywords ? <p className="break-words text-sm leading-6 opacity-70">{detail.keywords}</p> : null}
                        {kind === "pose" && depth ? <Alert type="info" message={t("assetLibrary.depthNote")} /> : null}
                        {error ? <Alert type="error" showIcon message={error} /> : null}
                        <div className="flex justify-end gap-2">
                            {importing ? (
                                <Button type="text" onClick={() => operation.current?.abort()}>
                                    {t("characterLibrary.cancel")}
                                </Button>
                            ) : null}
                            <Button type="primary" loading={importing} disabled={!selected.length} onClick={() => void apply()}>
                                {importing ? t("assetLibrary.applying", { done: progress, count: selected.length }) : t("characterLibrary.apply")}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
