// 工作流模板节点:把连入的组(组内节点 + 连线 + 节点设置)存成模板,之后一键按原布局铺回画布。
// 模板存在插件私有存储(ctx.storage 的 templates 键),跨画布共享。
import { definePlugin, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";
import { STORAGE_KEY, captureGroup, instantiateTemplate, randomId } from "./logic";
import type { TemplateNode, WorkflowTemplate } from "./logic";

// 模板列表变更事件:多个模板节点之间同步刷新
const CHANGED_EVENT = "workflow-template:changed";
// 插入位置:模板节点右侧留出的间距
const INSERT_GAP = 80;

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// blob: 地址只在当前页面会话有效,存模板前转成 data URL;
// 成功后去掉 storageKey,避免模板引用到可能被回收的本地图片
async function inlineMedia(nodes: TemplateNode[]): Promise<TemplateNode[]> {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata.content;
            if (node.type !== "image" || typeof content !== "string" || !content.startsWith("blob:")) return node;
            try {
                const dataUrl = await blobToDataUrl(await (await fetch(content)).blob());
                const metadata: Record<string, unknown> = { ...node.metadata, content: dataUrl };
                delete metadata.storageKey;
                return { ...node, metadata };
            } catch {
                return node;
            }
        }),
    );
}

function WorkflowTemplateContent({ ctx }: CanvasNodeContentProps) {
    const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    // 当前正在重命名的模板 id:Enter/Escape 之后输入框卸载还会触发 blur,用 ref 防止重复提交或撤销后仍提交
    const renamingRef = useRef<string | null>(null);
    const [message, setMessage] = useState("");

    const theme = ctx.theme;
    // 取第一个上游组节点
    const group = ctx.getUpstream().find((node) => node.type === "group") || null;

    const load = async () => {
        try {
            const list = await ctx.storage.get<WorkflowTemplate[]>(STORAGE_KEY);
            setTemplates(Array.isArray(list) ? list : []);
        } catch {
            setTemplates([]);
        }
    };

    useEffect(() => {
        void load();
        return ctx.on(CHANGED_EVENT, () => void load());
    }, []);

    const persist = async (next: WorkflowTemplate[]) => {
        setTemplates(next);
        await ctx.storage.set(STORAGE_KEY, next);
        ctx.emit(CHANGED_EVENT);
    };

    const save = async () => {
        if (!group || saving) return;
        setSaving(true);
        try {
            const captured = captureGroup(group.id, ctx.getNodes(), ctx.getConnections());
            const template: WorkflowTemplate = {
                id: randomId("wt"),
                name: name.trim() || group.title || `模板 ${templates.length + 1}`,
                createdAt: Date.now(),
                nodes: await inlineMedia(captured.nodes),
                connections: captured.connections,
            };
            await persist([template, ...templates]);
            setName("");
            setMessage(`已保存「${template.name}」`);
        } catch {
            setMessage("保存失败,请重试");
        } finally {
            setSaving(false);
        }
    };

    const insert = (template: WorkflowTemplate) => {
        const origin = { x: ctx.node.position.x + ctx.node.width + INSERT_GAP, y: ctx.node.position.y };
        ctx.applyOps(instantiateTemplate(template, origin, () => randomId("node")));
        setMessage(`已插入「${template.name}」`);
    };

    const commitRename = async () => {
        const id = renamingRef.current;
        const value = renameValue.trim();
        renamingRef.current = null;
        setRenamingId(null);
        if (!id || !value) return;
        await persist(templates.map((t) => (t.id === id ? { ...t, name: value } : t)));
    };

    const remove = async (id: string) => {
        await persist(templates.filter((t) => t.id !== id));
    };

    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
    const btn = { padding: "4px 10px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.toolbar.panel, color: theme.node.text, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" } as const;
    const smallBtn = { ...btn, padding: "2px 8px" } as const;
    const input = { flex: 1, minWidth: 0, padding: "4px 8px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.node.fill, color: theme.node.text, fontSize: 12, outline: "none" } as const;

    return (
        <div data-canvas-no-zoom onMouseDown={(e) => {
            if (e.target instanceof Element && e.target.closest("input, textarea, select, button")) e.stopPropagation();
        }} onDoubleClick={stop} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, boxSizing: "border-box", color: theme.node.text, fontSize: 12 }}>
            {/* 保存区:仅在有上游组时可用 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 8, borderBottom: `1px solid ${theme.node.stroke}` }}>
                <div style={{ color: theme.node.muted }}>{group ? `已连入组「${group.title || "未命名组"}」` : "连入一个组即可存为模板"}</div>
                <div style={{ display: "flex", gap: 6 }}>
                    <input value={name} disabled={!group} placeholder={group?.title || "模板名称"} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void save()} style={{ ...input, opacity: group ? 1 : 0.5 }} />
                    <button type="button" disabled={!group || saving} onClick={() => void save()} style={{ ...btn, opacity: group && !saving ? 1 : 0.5, cursor: group && !saving ? "pointer" : "not-allowed" }}>
                        {saving ? "保存中…" : "存为模板"}
                    </button>
                </div>
            </div>

            {/* 模板列表 */}
            <div onWheel={stop} style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {templates.length === 0 ? (
                    <div style={{ color: theme.node.placeholder, padding: "12px 0", textAlign: "center" }}>还没有模板</div>
                ) : (
                    templates.map((t) => (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.node.panel }}>
                            {renamingId === t.id ? (
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={() => void commitRename()}
                                    onKeyDown={(e) => {
                                        // 中文输入法组字时的 Enter 只用于确认拼音,不提交
                                        if (e.key === "Enter" && !e.nativeEvent.isComposing) void commitRename();
                                        if (e.key === "Escape") {
                                            renamingRef.current = null;
                                            setRenamingId(null);
                                        }
                                    }}
                                    style={input}
                                />
                            ) : (
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.name}>
                                        {t.name}
                                    </div>
                                    <div style={{ color: theme.node.faint, fontSize: 11 }}>
                                        {Math.max(t.nodes.length - 1, 0)} 个节点 · {t.connections.length} 条连线
                                    </div>
                                </div>
                            )}
                            <button type="button" style={smallBtn} onClick={() => insert(t)}>
                                插入
                            </button>
                            <button
                                type="button"
                                style={smallBtn}
                                onClick={() => {
                                    renamingRef.current = t.id;
                                    setRenamingId(t.id);
                                    setRenameValue(t.name);
                                }}
                            >
                                重命名
                            </button>
                            <button type="button" style={smallBtn} onClick={() => void remove(t.id)}>
                                删除
                            </button>
                        </div>
                    ))
                )}
            </div>

            {message ? <div style={{ color: theme.node.muted }}>{message}</div> : null}
        </div>
    );
}

export default definePlugin({
    id: "workflow-template",
    name: "工作流模板节点",
    version: "1.0.0",
    description: "把一组节点存成模板,一键复用",
    nodes: [
        {
            type: "workflow-template:node",
            title: "工作流模板",
            icon: "🧰",
            description: "把连入的组存成模板,一键按原布局插入",
            defaultSize: { width: 340, height: 380 },
            minimapColor: "#0ea5e9",
            // 纯工具节点:不弹出下方生成面板
            hidePanel: true,
            Content: WorkflowTemplateContent,
        },
    ],
});
