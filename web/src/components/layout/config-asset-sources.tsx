import { App, Alert, Button, Form, Input, Modal, Select, Switch, Tag } from "antd";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useAssetSourceStore } from "@/stores/use-asset-source-store";
import { loadAssetFeed } from "@/services/api/asset-library";
import { validateAssetFeeds, type AssetFeed } from "@/plugins/character-library/asset-catalog";

export function ConfigAssetSources() {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const sources = useAssetSourceStore((s) => s.sources);
    const { save, toggle, remove } = useAssetSourceStore.getState();
    const client = useQueryClient();
    const [editing, setEditing] = useState<AssetFeed | null>(null);
    const [refreshing, setRefreshing] = useState<string[]>([]);
    const [form] = Form.useForm<AssetFeed>();
    const refresh = async (source: AssetFeed) => {
        setRefreshing((ids) => [...ids, source.id]);
        try {
            const result = await loadAssetFeed(source, true);
            await client.invalidateQueries({ queryKey: ["asset-library", source.kind] });
            if (result.stale) message.warning(t("assetLibrary.cached", { name: source.name }));
            else message.success(t("assetLibrary.refreshed", { name: source.name, count: result.items.length }));
        } catch {
            message.error(t("assetLibrary.sourceFailed", { name: source.name }));
        } finally {
            setRefreshing((ids) => ids.filter((id) => id !== source.id));
        }
    };
    const edit = (source?: AssetFeed) => {
        const next: AssetFeed = source || { id: nanoid(), name: "", kind: "costume", url: "", baseUrl: "", homepage: "", enabled: true, builtIn: false };
        form.setFieldsValue(next);
        setEditing(next);
    };
    return (
        <div className="space-y-4">
            <p className="text-sm opacity-60">{t("assetLibrary.sourceNote")}</p>
            <div className="flex justify-end">
                <Button type="text" icon={<Plus className="size-4" />} onClick={() => edit()}>
                    {t("assetLibrary.addSource")}
                </Button>
            </div>
            {sources.map((source) => (
                <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-current/10 p-4">
                    <Switch checked={source.enabled} aria-label={source.name} onChange={(enabled) => toggle(source.id, enabled)} />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 font-semibold">
                            {source.name}
                            <Tag>{t(`assetLibrary.${source.kind}`)}</Tag>
                            {source.builtIn ? <Tag>{t("assetLibrary.builtIn")}</Tag> : null}
                        </div>
                        <div className="mt-1 break-all text-xs opacity-55">{source.url}</div>
                    </div>
                    <Button type="text" icon={<RefreshCw className="size-4" />} loading={refreshing.includes(source.id)} onClick={() => void refresh(source)}>
                        {t("assetLibrary.refresh")}
                    </Button>
                    {!source.builtIn ? (
                        <>
                            <Button type="text" icon={<Pencil className="size-4" />} aria-label={t("assetLibrary.editSource")} onClick={() => edit(source)} />
                            <Button
                                type="text"
                                danger
                                icon={<Trash2 className="size-4" />}
                                aria-label={t("assetLibrary.deleteSource")}
                                onClick={() => modal.confirm({ title: t("assetLibrary.deleteSource"), content: source.name, onOk: () => remove(source.id) })}
                            />
                        </>
                    ) : null}
                </div>
            ))}
            <Alert type="info" showIcon message={t("assetLibrary.formatNote")} />
            <Modal open={Boolean(editing)} title={t("assetLibrary.addSource")} onCancel={() => setEditing(null)} onOk={() => form.submit()} destroyOnHidden>
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={(values) => {
                        try {
                            save(validateAssetFeeds([{ ...editing, ...values }])[0]);
                            setEditing(null);
                        } catch {
                            message.error(t("assetLibrary.invalidFeed"));
                        }
                    }}
                >
                    <Form.Item name="name" label={t("assetLibrary.sourceName")} rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="kind" label={t("assetLibrary.kind")} rules={[{ required: true }]}>
                        <Select options={["pose", "costume", "portrait"].map((value) => ({ value, label: t(`assetLibrary.${value}`) }))} />
                    </Form.Item>
                    <Form.Item name="url" label={t("characterLibrary.url")} rules={[{ required: true }]}>
                        <Input placeholder="https://HOST/data/costume-zh.json" />
                    </Form.Item>
                    <Form.Item name="baseUrl" label={t("assetLibrary.baseUrl")} rules={[{ required: true }]}>
                        <Input placeholder="https://HOST/" />
                    </Form.Item>
                    <Form.Item name="homepage" label={t("assetLibrary.homepage")} rules={[{ required: true }]}>
                        <Input placeholder="https://HOST/" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
