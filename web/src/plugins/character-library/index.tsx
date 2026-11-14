import { useEffect, useMemo, useRef, useState } from "react";
import { App, Alert, Button, Card, Empty, Input, Menu, Modal, Pagination, Select, Spin, Tag, Tabs } from "antd";
import { FolderOpen, Image as ImageIcon, Search, Settings2, UsersRound } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useCanvasTheme } from "@/hooks/use-canvas-theme";
import { PROMPT_PAGE_SIZE } from "@/components/prompts/use-prompt-list";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasPlugin, CanvasPluginHost, PluginStoredImage } from "@/types/canvas-plugin";
import { deleteStoredImages } from "@/services/image-storage";
import { focusViewportForNode } from "@/lib/canvas/canvas-node-geometry";
import { CHARACTER_LIBRARY_DEMO, chooseCharacterDirectory, loadCharacterDetail, restoreCharacterSource, saveCharacterUrl, type CharacterSource } from "@/services/api/character-library";
import { buildCharacterGroup, filterCharacters, type CharacterDetail, type CharacterRole } from "./catalog";
import { OnlineAssets } from "./online-assets";
import type { AssetKind } from "./asset-catalog";

function CharacterImage({ source, path, title, className = "" }: { source: CharacterSource; path: string; title: string; className?: string }) {
    const { t } = useTranslation();
    const [image, setImage] = useState<{ source: CharacterSource; path: string; url: string } | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        let release: (() => void) | undefined;
        setFailed(false);
        source
            .preview(path)
            .then((result) => {
                if (!active) return result.revoke();
                release = result.revoke;
                setImage({ source, path, url: result.url });
            })
            .catch(() => {
                if (active) setFailed(true);
            });
        return () => {
            active = false;
            release?.();
        };
    }, [source, path]);
    if (failed)
        return (
            <div className={`grid place-items-center ${className}`} role="img" aria-label={t("characterLibrary.imageFailed")}>
                <ImageIcon className="size-6 opacity-40" />
            </div>
        );
    return <img src={image?.source === source && image.path === path ? image.url : undefined} alt={title} loading="lazy" className={`object-contain ${className}`} onError={() => setFailed(true)} />;
}

function CharacterLibraryModal({ host, onClose }: { host: CanvasPluginHost; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = useCanvasTheme();
    const [tab, setTab] = useState<"character" | AssetKind>("character");
    const [source, setSource] = useState<CharacterSource | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [url, setUrl] = useState("");
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("");
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [page, setPage] = useState(1);
    const [detail, setDetail] = useState<CharacterDetail | null>(null);
    const [readingDetail, setReadingDetail] = useState(false);
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const operation = useRef<AbortController | null>(null);
    const detailRequest = useRef(0);
    const importGuard = useRef(false);
    const errorText = (value: unknown) => (value instanceof Error && value.message.startsWith("characterLibrary.") ? t(value.message) : t("characterLibrary.failed"));
    useEffect(() => {
        const controller = new AbortController();
        restoreCharacterSource(controller.signal)
            .then((value) => {
                if (!controller.signal.aborted) {
                    setSource(value);
                    setUrl(value.key.startsWith("directory:") ? "" : value.key);
                }
            })
            .catch((value) => {
                if (!controller.signal.aborted) {
                    setError(errorText(value));
                    setSettingsOpen(true);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => {
            controller.abort();
            operation.current?.abort();
            detailRequest.current++;
        };
    }, []);

    const roles = source?.roles || [];
    const filtered = useMemo(() => filterCharacters(roles, keyword, category, filters), [roles, keyword, category, filters]);
    const categories = useMemo(() => {
        const grouped = new Map<string, string[]>();
        for (const role of roles) {
            const parent = role.category.split("·")[0];
            if (!grouped.has(parent)) grouped.set(parent, []);
            if (role.category !== parent && !grouped.get(parent)!.includes(role.category)) grouped.get(parent)!.push(role.category);
        }
        return [
            { key: "", label: t("characterLibrary.all") },
            ...Array.from(grouped, ([parent, children]) => ({
                key: parent,
                label: parent,
                children: children.length ? [{ key: `${parent}:all`, label: t("characterLibrary.all") }, ...children.map((name) => ({ key: name, label: name.split("·").slice(1).join("·") }))] : undefined,
            })),
        ];
    }, [roles, t]);
    const attributes = useMemo(() => {
        const candidates = filterCharacters(roles, "", category, {});
        const keys = ["性别", "年龄段", "物种", "体格", "身高", "肤色", "发长", "发色", "气质", "地域/族裔"];
        return keys.flatMap((key) => {
            const values = [...new Set(candidates.map((role) => role.attributes[key]).filter(Boolean))];
            return values.length ? [{ key, values }] : [];
        });
    }, [roles, category]);

    const connect = async (directory = false, demo = false) => {
        detailRequest.current++;
        setReadingDetail(false);
        setLoading(true);
        setError("");
        const controller = new AbortController();
        operation.current?.abort();
        operation.current = controller;
        try {
            const next = directory ? await chooseCharacterDirectory() : await saveCharacterUrl(demo ? CHARACTER_LIBRARY_DEMO : url, controller.signal);
            if (controller.signal.aborted) return;
            setSource(next);
            setUrl(next.key.startsWith("directory:") ? "" : next.key);
            setCategory("");
            setFilters({});
            setKeyword("");
            setPage(1);
            setDetail(null);
            setSettingsOpen(false);
            message.success(t("characterLibrary.sourceSaved"));
        } catch (value) {
            if (!controller.signal.aborted && !(value instanceof DOMException && value.name === "AbortError")) setError(errorText(value));
        } finally {
            if (!controller.signal.aborted) setLoading(false);
        }
    };
    const inspect = async (role: CharacterRole) => {
        if (!source || importing) return;
        const request = ++detailRequest.current;
        setReadingDetail(true);
        setError("");
        try {
            const next = await loadCharacterDetail(source, role);
            if (request === detailRequest.current) setDetail(next);
        } catch (value) {
            if (request === detailRequest.current) setError(errorText(value));
        } finally {
            if (request === detailRequest.current) setReadingDetail(false);
        }
    };
    const apply = async () => {
        if (!detail || !source || !host.media || importGuard.current) return;
        importGuard.current = true;
        setImporting(true);
        setProgress(0);
        setError("");
        const controller = new AbortController();
        operation.current = controller;
        const images: PluginStoredImage[] = [];
        let committed = false;
        try {
            for (const asset of detail.assets) {
                controller.signal.throwIfAborted();
                const blob = await source.image(asset.path, controller.signal);
                controller.signal.throwIfAborted();
                const objectUrl = URL.createObjectURL(blob);
                try {
                    images.push(await host.media.saveImage(objectUrl, controller.signal));
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
                setProgress(images.length);
            }
            controller.signal.throwIfAborted();
            const id = nanoid();
            const ops = buildCharacterGroup(detail, images, host.getNodes(), id, NODE_DEFAULT_SIZE[CanvasNodeType.Image].width);
            const group = ops[0];
            if (group.type !== "add_node" || !group.position || !group.width || !group.height) throw new Error("characterLibrary.importFailed");
            const viewport = focusViewportForNode({ position: group.position, width: group.width, height: group.height }, { width: window.innerWidth, height: window.innerHeight });
            host.applyOps([...ops, { type: "set_viewport", viewport }]);
            committed = true;
            message.success(t("characterLibrary.inserted"));
            onClose();
        } catch (value) {
            if (!controller.signal.aborted) {
                const text = value instanceof Error && value.message.startsWith("characterLibrary.") ? t(value.message) : t("characterLibrary.importFailed");
                setError(text);
                message.error(text);
            }
        } finally {
            if (!committed) await deleteStoredImages(images.map((image) => image.storageKey)).catch(console.error);
            importGuard.current = false;
            if (!controller.signal.aborted) setImporting(false);
        }
    };

    return (
        <>
            <Modal
                open
                title={
                    <div className="flex flex-wrap items-center gap-3 pr-6">
                        <UsersRound className="size-5" />
                        <span>{t("assetLibrary.title")}</span>
                        {tab === "character" ? <span className="text-xs font-normal opacity-60">{t("characterLibrary.count", { count: roles.length })}</span> : null}
                        {tab === "character" ? (
                            <div className="ml-auto flex items-center gap-2">
                                <Input
                                    allowClear
                                    prefix={<Search className="size-4" />}
                                    placeholder={t("characterLibrary.search")}
                                    value={keyword}
                                    onChange={(event) => {
                                        setKeyword(event.target.value);
                                        setPage(1);
                                    }}
                                />
                                <Button type="text" icon={<Settings2 className="size-4" />} aria-label={t("characterLibrary.settings")} onClick={() => setSettingsOpen(true)} />
                            </div>
                        ) : null}
                    </div>
                }
                onCancel={onClose}
                footer={null}
                width="min(1440px, 96vw)"
                centered
                styles={{ body: { height: "78dvh", overflow: "hidden" } }}
            >
                <div className="flex h-full min-h-0 flex-col">
                    <Tabs activeKey={tab} onChange={(key) => setTab(key as typeof tab)} items={["character", "pose", "costume", "portrait"].map((key) => ({ key, label: t(`assetLibrary.${key}`) }))} />
                    {tab !== "character" ? (
                        <OnlineAssets key={tab} kind={tab} host={host} onClose={onClose} />
                    ) : (
                        <div className="flex flex-1 min-h-0 gap-4" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                            <aside className="thin-scrollbar w-48 shrink-0 overflow-y-auto border-r pr-3 max-sm:hidden" style={{ borderColor: theme.node.stroke }}>
                                <Menu
                                    mode="inline"
                                    selectedKeys={[category]}
                                    items={categories}
                                    onClick={({ key }) => {
                                        setCategory(key.replace(/:all$/, ""));
                                        setFilters({});
                                        setPage(1);
                                    }}
                                    style={{ background: "transparent", border: 0, color: "inherit" }}
                                />
                            </aside>
                            <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
                                {error ? <Alert type="error" message={error} showIcon /> : null}
                                {source?.key.endsWith(CHARACTER_LIBRARY_DEMO) ? <Alert type="info" message={t("characterLibrary.demoNote")} showIcon /> : null}
                                <div className="flex flex-wrap items-center gap-2">
                                    <Select
                                        className="min-w-36 sm:hidden"
                                        value={category}
                                        options={[{ value: "", label: t("characterLibrary.all") }, ...[...new Set(roles.map((role) => role.category))].map((value) => ({ value, label: value }))]}
                                        onChange={(value) => {
                                            setCategory(value);
                                            setFilters({});
                                            setPage(1);
                                        }}
                                    />
                                    {attributes.map(({ key, values }) => (
                                        <Select
                                            key={key}
                                            allowClear
                                            size="small"
                                            className="min-w-24"
                                            aria-label={key}
                                            placeholder={key}
                                            value={filters[key] || undefined}
                                            options={values.map((value) => ({ value, label: value }))}
                                            onChange={(value) => {
                                                setFilters((current) => ({ ...current, [key]: value || "" }));
                                                setPage(1);
                                            }}
                                        />
                                    ))}
                                    {Object.values(filters).some(Boolean) ? (
                                        <Button
                                            type="text"
                                            size="small"
                                            onClick={() => {
                                                setFilters({});
                                                setPage(1);
                                            }}
                                        >
                                            {t("characterLibrary.reset")}
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
                                    <Spin spinning={loading || readingDetail} tip={t("characterLibrary.loading")}>
                                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                            {source &&
                                                filtered.slice((page - 1) * PROMPT_PAGE_SIZE, page * PROMPT_PAGE_SIZE).map((role) => (
                                                    <Card key={`${source.key}:${role.id}`} hoverable styles={{ body: { padding: 0 } }} className="overflow-hidden">
                                                        <button type="button" className="block w-full text-left" onClick={() => void inspect(role)}>
                                                            <CharacterImage source={source} path={role.preview} title={role.name} className="aspect-[3/4] w-full" />
                                                            <div className="p-3">
                                                                <div className="truncate text-sm font-semibold">{role.name}</div>
                                                                <div className="mt-1 truncate text-xs opacity-55">
                                                                    {["性别", "年龄段", "物种", "体格"]
                                                                        .map((key) => role.attributes[key])
                                                                        .filter(Boolean)
                                                                        .join("·")}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    </Card>
                                                ))}
                                        </div>
                                        {!loading && !filtered.length ? <Empty description={t("characterLibrary.empty")} /> : null}
                                    </Spin>
                                </div>
                                <Pagination size="small" current={page} pageSize={PROMPT_PAGE_SIZE} total={filtered.length} showSizeChanger={false} hideOnSinglePage onChange={setPage} />
                            </section>
                        </div>
                    )}
                </div>
            </Modal>
            <Modal
                open={Boolean(detail)}
                title={detail?.name || t("characterLibrary.preview")}
                onCancel={() => {
                    if (!importing) setDetail(null);
                }}
                maskClosable={!importing}
                closable={!importing}
                footer={null}
                width="min(1200px, 94vw)"
                centered
                styles={{ body: { maxHeight: "76dvh", overflowY: "auto" } }}
            >
                {detail && source ? (
                    <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]" data-canvas-no-zoom>
                        <div className="grid grid-cols-3 gap-3">
                            {detail.assets.map((asset, index) => (
                                <div key={asset.label} className={index === 3 ? "col-span-3" : ""}>
                                    <CharacterImage source={source} path={asset.path} title={`${detail.name} · ${asset.label}`} className={`${index === 3 ? "h-[25vh]" : "h-[28vh]"} w-full rounded-lg`} />
                                    <div className="mt-1 text-center text-xs opacity-60">{asset.label}</div>
                                </div>
                            ))}
                        </div>
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-1">
                                {detail.tags.map((tag, index) => (
                                    <Tag key={`${tag}:${index}`}>{tag}</Tag>
                                ))}
                            </div>
                            <h3 className="font-semibold">{t("characterLibrary.attributes")}</h3>
                            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                {Object.entries(detail.attributes).map(([key, value]) => (
                                    <div key={key} className="flex justify-between gap-2">
                                        <dt className="opacity-55">{key}</dt>
                                        <dd>{value}</dd>
                                    </div>
                                ))}
                            </dl>
                            {detail.descriptions.map((description) => (
                                <div key={description.label}>
                                    <h4 className="mb-1 text-sm font-semibold">{description.label}</h4>
                                    <p className="text-sm leading-6 opacity-70">{description.text}</p>
                                </div>
                            ))}
                            <Button type="primary" block loading={importing} onClick={() => void apply()}>
                                {importing ? t("characterLibrary.applying", { done: progress }) : t("characterLibrary.apply")}
                            </Button>
                            {importing ? (
                                <Button
                                    type="text"
                                    block
                                    onClick={() => {
                                        operation.current?.abort();
                                        setImporting(false);
                                    }}
                                >
                                    {t("characterLibrary.cancel")}
                                </Button>
                            ) : null}
                            {error ? <Alert type="error" message={error} showIcon /> : null}
                        </div>
                    </div>
                ) : null}
            </Modal>
            <Modal
                open={settingsOpen}
                title={t("characterLibrary.settings")}
                onCancel={() => {
                    if (!loading) setSettingsOpen(false);
                }}
                footer={null}
                centered
            >
                <div className="space-y-4">
                    <label className="block space-y-2">
                        <span>{t("characterLibrary.url")}</span>
                        <Input value={url} placeholder="https://HOST/character-library/index.json" disabled={loading} onChange={(event) => setUrl(event.target.value)} onPressEnter={() => void connect()} />
                    </label>
                    <Button type="primary" loading={loading} disabled={!url.trim()} onClick={() => void connect()}>
                        {t("characterLibrary.connect")}
                    </Button>
                    <p className="text-xs leading-5 opacity-60">{t("characterLibrary.urlNote")}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button icon={<FolderOpen className="size-4" />} disabled={loading} onClick={() => void connect(true)}>
                            {t("characterLibrary.directory")}
                        </Button>
                        <Button disabled={loading} onClick={() => void connect(false, true)}>
                            {t("characterLibrary.demo")}
                        </Button>
                    </div>
                    <p className="text-xs leading-5 opacity-60">{t("characterLibrary.localNote")}</p>
                    {error ? <Alert type="error" message={error} showIcon /> : null}
                </div>
            </Modal>
        </>
    );
}

const plugin: CanvasPlugin = {
    id: "character-library",
    get name() {
        return i18n.t("assetLibrary.title");
    },
    version: "1.1.0",
    nodes: [],
    panels: [
        {
            id: "character-library:browser",
            get title() {
                return i18n.t("assetLibrary.title");
            },
            icon: <UsersRound className="size-4.5" />,
            Content: CharacterLibraryModal,
        },
    ],
};
export default plugin;
