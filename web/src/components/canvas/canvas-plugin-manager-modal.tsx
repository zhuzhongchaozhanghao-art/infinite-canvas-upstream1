import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm, Switch, Tabs } from "antd";
import { AlertTriangle, Download, Plus, Puzzle, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useCanvasTheme } from "@/hooks/use-canvas-theme";
import { getNodePluginId, getNodeSpec, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { installPluginFromUrl, setPluginEnabled, uninstallPlugin, updatePlugin } from "@/lib/canvas/plugin-loader";
import { fetchOfficialPlugins, hasUpgrade, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

// 节点管理器：按节点浏览已注册节点（内置 + 插件），并合并原插件的安装、启停、更新、卸载
export function CanvasPluginManagerModal({ open, onClose, onCreateNode }: { open: boolean; onClose: () => void; onCreateNode?: (type: string) => void }) {
    const { t } = useTranslation();
    const theme = useCanvasTheme();
    const { message } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [keyword, setKeyword] = useState("");
    useNodeRegistryVersion();

    const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
    const [loadingOfficial, setLoadingOfficial] = useState(false);
    const [officialError, setOfficialError] = useState<string | null>(null);

    const recordById = useMemo(() => new Map(plugins.map((item) => [item.id, item])), [plugins]);
    // 搜索同时作用于节点和插件列表
    const query = keyword.trim().toLowerCase();
    const matches = (...texts: (string | undefined)[]) => !query || texts.some((text) => text?.toLowerCase().includes(query));
    const localPlugins = plugins.filter((item) => item.local && matches(item.name, item.id, item.description));
    const thirdPartyPlugins = plugins.filter((item) => !item.local && !item.official && matches(item.name, item.id, item.description, item.url));
    const officialFiltered = official.filter((entry) => matches(entry.name, entry.id, entry.description));

    const loadOfficial = useCallback(async () => {
        setLoadingOfficial(true);
        setOfficialError(null);
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingOfficial(false);
        }
    }, []);

    // Fetch the official registry when opening the panel, but only if it has not been loaded yet.
    useEffect(() => {
        if (open && official.length === 0 && !loadingOfficial && !officialError) void loadOfficial();
    }, [open, official.length, loadingOfficial, officialError, loadOfficial]);

    const handleInstallUrl = async () => {
        const target = url.trim();
        if (!target) return;
        setInstalling(true);
        try {
            const plugin = await installPluginFromUrl(target);
            message.success(t("canvas.plugins.installedPlugin", { name: plugin.name }));
            setUrl("");
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setInstalling(false);
        }
    };

    const handleInstallOfficial = async (entry: OfficialPluginEntry) => {
        setBusyId(entry.id);
        try {
            const plugin = await installPluginFromUrl(entry.url, { official: true });
            message.success(t("canvas.plugins.installed", { name: plugin.name }));
        } catch (error) {
            message.error(t("canvas.plugins.installFailed", { error: error instanceof Error ? error.message : String(error) }));
        } finally {
            setBusyId(null);
        }
    };

    const runOnPlugin = async (record: InstalledPlugin, action: () => Promise<void>, successText: string) => {
        setBusyId(record.id);
        try {
            await action();
            message.success(successText);
        } catch (error) {
            message.error(`${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    // Installed plugin actions: enable toggle plus update/uninstall for non-local plugins.
    // Highlight the update action when a newer remote version is available.
    const installedControls = (record: InstalledPlugin, upgradable = false) => (
        <>
            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(checked) => runOnPlugin(record, () => setPluginEnabled(record, checked), t(checked ? "canvas.plugins.enabled" : "canvas.plugins.disabled"))} />
            {!record.local && (
                <>
                    <Button
                        type={upgradable ? "primary" : "text"}
                        size="small"
                        icon={<RefreshCw className="size-4" />}
                        loading={busyId === record.id}
                        title={t(upgradable ? "canvas.plugins.upgradeAvailable" : "canvas.plugins.updateFromSource")}
                        onClick={() => runOnPlugin(record, async () => void (await updatePlugin(record)), t("canvas.plugins.updated"))}
                    />
                    <Popconfirm title={t("canvas.plugins.uninstallTitle")} okText={t("canvas.plugins.uninstall")} cancelText={t("canvas.editors.cancel")} onConfirm={() => uninstallPlugin(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title={t("canvas.plugins.uninstall")} />
                    </Popconfirm>
                </>
            )}
        </>
    );

    // Add a green dot at the icon's top-right corner when an update is available.
    // A card-colored box shadow separates the dot visually from the icon.
    const withUpgradeDot = (icon: ReactNode) => (
        <span className="relative inline-flex">
            {icon}
            <span className="absolute -right-1 -top-1 size-2 rounded-full" style={{ background: "#22c55e", boxShadow: `0 0 0 2px ${theme.node.fill}` }} title={t("canvas.plugins.newVersion")} />
        </span>
    );

    const versionTag = (version: string) => (
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
            v{version}
        </span>
    );

    const emptyHint = (text: string) => (
        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>
            {text}
        </div>
    );

    // Shared plugin row: icon, title with name and version, description, and actions.
    const row = (key: string, icon: ReactNode, name: string, version: string, subtitle: string | undefined, right: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg text-base" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    {versionTag(version)}
                </div>
                {subtitle ? (
                    <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {right}
        </div>
    );

    const officialTab = (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.plugins.officialDescription")}
                </div>
                <Button type="text" size="small" icon={<RefreshCw className={`size-4 ${loadingOfficial ? "animate-spin" : ""}`} />} onClick={loadOfficial} disabled={loadingOfficial}>
                    {t("canvas.plugins.refresh")}
                </Button>
            </div>
            {officialError ? (
                <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {t("canvas.plugins.loadFailed", { error: officialError })}
                </div>
            ) : loadingOfficial && official.length === 0 ? (
                emptyHint(t("canvas.plugins.loadingOfficial"))
            ) : official.length === 0 ? (
                emptyHint(t("canvas.plugins.noOfficial"))
            ) : (
                <div className="thin-scrollbar max-h-[46vh] space-y-2 overflow-auto">
                    {officialFiltered.map((entry) => {
                        const record = recordById.get(entry.id);
                        // Show the update dot and highlight the action when the remote version is newer.
                        const upgradable = Boolean(record && hasUpgrade(record.version, entry.version));
                        const icon = entry.icon || <Puzzle className="size-4" />;
                        return row(
                            entry.id,
                            upgradable ? withUpgradeDot(icon) : icon,
                            entry.name,
                            // Show local and remote versions in the title so the update target is explicit.
                            upgradable && record ? `${record.version} → ${entry.version}` : entry.version,
                            entry.description,
                            record ? (
                                installedControls(record, upgradable)
                            ) : (
                                <Button type="primary" size="small" icon={<Download className="size-4" />} loading={busyId === entry.id} onClick={() => handleInstallOfficial(entry)}>
                                    {t("canvas.plugins.install")}
                                </Button>
                            ),
                        );
                    })}
                </div>
            )}
        </div>
    );

    const localTab = <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{localPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>;

    const thirdPartyTab = (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Input placeholder={t("canvas.plugins.urlPlaceholder")} value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={handleInstallUrl} allowClear />
                <Button type="primary" loading={installing} onClick={handleInstallUrl} icon={<Puzzle className="size-4" />}>
                    {t("canvas.plugins.install")}
                </Button>
            </div>
            <div className="thin-scrollbar max-h-[42vh] space-y-2 overflow-auto">{thirdPartyPlugins.length === 0 ? emptyHint(t("canvas.plugins.noThirdParty")) : thirdPartyPlugins.map((record) => row(record.id, <Puzzle className="size-4" />, record.name, record.version, record.description || record.url, installedControls(record)))}</div>
        </div>
    );

    // 节点按来源分组：内置在前，其后每个已安装插件一组；停用插件的节点未注册，只显示提示
    const definitions = listNodeDefinitions();
    const nodeGroups = [
        { id: "builtin", name: t("canvas.plugins.builtinGroup"), record: undefined as InstalledPlugin | undefined },
        ...plugins.map((record) => ({ id: record.id, name: record.name, record })),
    ]
        .map((group) => ({ ...group, defs: definitions.filter((def) => getNodePluginId(def.type) === group.id && matches(getNodeSpec(def.type).title, def.type, def.description, group.name)) }))
        .filter((group) => group.defs.length > 0 || (group.record && !group.record.enabled && matches(group.name, group.id)));

    const nodeCard = (def: (typeof definitions)[number]) => (
        <div key={def.type} className="flex items-start gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {def.icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: theme.node.text }}>
                    {getNodeSpec(def.type).title}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px]" style={{ color: theme.node.muted }} title={def.type}>
                    {def.type}
                </div>
                {def.description ? (
                    <div className="mt-1 line-clamp-2 text-xs" style={{ color: theme.node.muted }}>
                        {def.description}
                    </div>
                ) : null}
            </div>
            {onCreateNode && def.showInCreateMenu !== false ? (
                <Button
                    type="text"
                    size="small"
                    icon={<Plus className="size-4" />}
                    title={t("canvas.plugins.addToCanvas")}
                    onClick={() => {
                        onCreateNode(def.type);
                        onClose();
                    }}
                />
            ) : null}
        </div>
    );

    const nodesTab = (
        <div className="thin-scrollbar max-h-[56vh] space-y-4 overflow-auto pr-1">
            {nodeGroups.length === 0
                ? emptyHint(t("canvas.plugins.noNodes"))
                : nodeGroups.map((group) => (
                      <div key={group.id}>
                          <div className="mb-2 flex items-center gap-2">
                              <span className="text-sm font-medium" style={{ color: theme.node.text }}>
                                  {group.name}
                              </span>
                              {group.record ? versionTag(group.record.version) : null}
                              <span className="text-xs" style={{ color: theme.node.muted }}>
                                  {t("canvas.plugins.nodeCount", { count: group.defs.length })}
                              </span>
                              <span className="flex-1" />
                              {group.record ? (
                                  <Switch size="small" checked={group.record.enabled} loading={busyId === group.id} onChange={(checked) => runOnPlugin(group.record!, () => setPluginEnabled(group.record!, checked), t(checked ? "canvas.plugins.enabled" : "canvas.plugins.disabled"))} />
                              ) : null}
                          </div>
                          {group.defs.length > 0 ? (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{group.defs.map(nodeCard)}</div>
                          ) : (
                              <div className="rounded-lg border border-dashed px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                                  {t("canvas.plugins.pluginDisabledHint")}
                              </div>
                          )}
                      </div>
                  ))}
        </div>
    );

    const tabs = [
        { key: "nodes", label: t("canvas.plugins.nodesTab"), children: nodesTab },
        { key: "official", label: t("canvas.plugins.official"), children: officialTab },
        ...(plugins.some((item) => item.local) ? [{ key: "local", label: t("canvas.plugins.local"), children: localTab }] : []),
        { key: "third", label: t("canvas.plugins.thirdParty"), children: thirdPartyTab },
    ];

    return (
        <Modal title={t("canvas.plugins.title")} open={open} onCancel={onClose} footer={null} centered width={900}>
            <div className="space-y-3">
                <Input prefix={<Search className="size-4 opacity-50" />} placeholder={t("canvas.plugins.searchPlaceholder")} value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear />
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: "#f59e0b55", background: "#f59e0b14", color: theme.node.text }}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>{t("canvas.plugins.warning")}</span>
                </div>
                <Tabs defaultActiveKey="nodes" items={tabs} />
            </div>
        </Modal>
    );
}
