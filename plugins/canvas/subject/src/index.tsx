// 主体节点:一个节点代表一个主体(角色/商品等),带名称、类型、描述与 1–4 张参考图。
// 作为上游资源时输出多张参考图(可选附带描述文本);可存入主体库(插件存储,跨画布共享)后在任意画布载入。
import { definePlugin, getUpstreamImages, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext } from "@infinite-canvas/plugin-sdk";
import { addImage, buildSubjectResource, DEFAULT_SUBJECT_NAME, readSubject, removeSubject, renameSubject, SUBJECT_KINDS, SUBJECTS_KEY, subjectToMetadata, upsertSubject } from "./logic";
import type { SubjectKind, SubjectRecord } from "./logic";

// 交互控件上按下时阻止冒泡,避免触发节点拖动/画布缩放
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
const stopProps = { onMouseDown: stop, onPointerDown: stop, onDoubleClick: stop };

function newSubjectId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `subject-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(file);
    });
}

async function loadLibrary(ctx: CanvasNodeContext) {
    return (await ctx.storage.get<SubjectRecord[]>(SUBJECTS_KEY)) || [];
}

function SubjectContent({ ctx }: CanvasNodeContentProps) {
    const theme = ctx.theme;
    const subject = readSubject(ctx.node.metadata);
    const appendDescription = Boolean(ctx.node.metadata?.appendDescription);
    const [hint, setHint] = useState("");
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [library, setLibrary] = useState<SubjectRecord[]>([]);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    // 连续添加图片时用 ref 持有最新列表,避免多张图的异步读取互相覆盖
    const imagesRef = useRef(subject.images);
    imagesRef.current = subject.images;

    // 标题跟随主体名称
    const title = subject.name.trim() || DEFAULT_SUBJECT_NAME;
    useEffect(() => {
        if (ctx.node.title !== title) ctx.updateNode({ title });
    }, [title]);

    const setImages = (images: string[]) => {
        imagesRef.current = images;
        ctx.updateMetadata({ subjectImages: images });
    };

    // 逐张追加,超过上限时停下并提示
    const appendImages = (urls: string[]) => {
        let images = imagesRef.current;
        for (const url of urls) {
            const result = addImage(images, url);
            if (result.error) {
                setHint(result.error);
                break;
            }
            images = result.images;
        }
        if (images !== imagesRef.current) setImages(images);
    };

    const onFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setHint("");
        try {
            const urls = await Promise.all(Array.from(files).filter((file) => file.type.startsWith("image/")).map(readFileAsDataUrl));
            appendImages(urls);
        } catch (error) {
            setHint(error instanceof Error ? error.message : "图片读取失败");
        }
    };

    const pullUpstream = () => {
        setHint("");
        const urls = getUpstreamImages(ctx);
        if (!urls.length) {
            setHint("上游没有图片");
            return;
        }
        appendImages(urls);
    };

    const saveToLibrary = async () => {
        const record: SubjectRecord = { ...subject, id: subject.id || newSubjectId(), name: title };
        try {
            const next = upsertSubject(await loadLibrary(ctx), record);
            await ctx.storage.set(SUBJECTS_KEY, next);
            if (!subject.id) ctx.updateMetadata({ subjectId: record.id });
            setLibrary(next);
            setHint("已存入主体库");
        } catch {
            setHint("存入主体库失败");
        }
    };

    const openLibrary = async () => {
        setHint("");
        setRenamingId(null);
        setLibrary(await loadLibrary(ctx));
        setLibraryOpen(true);
    };

    const writeLibrary = async (next: SubjectRecord[]) => {
        setLibrary(next);
        await ctx.storage.set(SUBJECTS_KEY, next);
    };

    const pickFromLibrary = (record: SubjectRecord) => {
        ctx.updateMetadata(subjectToMetadata(record));
        setLibraryOpen(false);
        setHint(`已载入「${record.name || DEFAULT_SUBJECT_NAME}」`);
    };

    const commitRename = async (id: string) => {
        const name = renameDraft.trim();
        setRenamingId(null);
        if (name) await writeLibrary(renameSubject(library, id, name));
    };

    const inputStyle = { width: "100%", boxSizing: "border-box" as const, border: `1px solid ${theme.node.stroke}`, borderRadius: 8, background: theme.node.panel, color: theme.node.text, fontSize: 12, padding: "5px 8px", outline: "none", fontFamily: "inherit" };
    const buttonStyle = { border: `1px solid ${theme.toolbar.border}`, borderRadius: 8, background: theme.toolbar.item, color: theme.node.text, fontSize: 12, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" as const };
    const primaryStyle = { ...buttonStyle, background: theme.toolbar.activeBg, color: theme.toolbar.activeText, border: `1px solid ${theme.toolbar.activeBg}` };

    return (
        <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, boxSizing: "border-box", color: theme.node.text, fontSize: 12 }}>
            {/* 顶栏:留作拖动节点的把手 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, cursor: "move", userSelect: "none" }}>
                <span>👤</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{libraryOpen ? "主体库" : title}</span>
                {libraryOpen ? (
                    <button type="button" style={buttonStyle} data-canvas-no-zoom {...stopProps} onClick={() => setLibraryOpen(false)}>
                        返回
                    </button>
                ) : null}
            </div>

            {libraryOpen ? (
                <div data-canvas-no-zoom {...stopProps} onWheel={stop} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                    {library.length ? (
                        library.map((record) => (
                            <div key={record.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 6, borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: record.id === subject.id ? theme.toolbar.itemHover : theme.node.panel }}>
                                <div title="载入到当前节点" onClick={() => renamingId !== record.id && pickFromLibrary(record)} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: "pointer" }}>
                                    {record.images[0] ? (
                                        <img src={record.images[0]} alt="" draggable={false} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                                    ) : (
                                        <div style={{ width: 40, height: 40, borderRadius: 6, background: theme.node.placeholder, flexShrink: 0 }} />
                                    )}
                                    {renamingId === record.id ? (
                                        <input
                                            autoFocus
                                            value={renameDraft}
                                            onChange={(e) => setRenameDraft(e.target.value)}
                                            onBlur={() => void commitRename(record.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") void commitRename(record.id);
                                                if (e.key === "Escape") setRenamingId(null);
                                            }}
                                            style={inputStyle}
                                        />
                                    ) : (
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.name || DEFAULT_SUBJECT_NAME}</div>
                                            <div style={{ color: theme.node.muted }}>
                                                {SUBJECT_KINDS.find((item) => item.value === record.kind)?.label || "其他"} · {record.images.length} 张
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    style={buttonStyle}
                                    onClick={() => {
                                        setRenamingId(record.id);
                                        setRenameDraft(record.name);
                                    }}
                                >
                                    重命名
                                </button>
                                <button type="button" style={buttonStyle} onClick={() => void writeLibrary(removeSubject(library, record.id))}>
                                    删除
                                </button>
                            </div>
                        ))
                    ) : (
                        <div style={{ color: theme.node.muted, textAlign: "center", padding: 24 }}>主体库为空，先「存入主体库」</div>
                    )}
                </div>
            ) : (
                <div data-canvas-no-zoom {...stopProps} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                        <input value={subject.name} placeholder="主体名称" onChange={(e) => ctx.updateMetadata({ subjectName: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                        <select value={subject.kind} onChange={(e) => ctx.updateMetadata({ subjectKind: e.target.value as SubjectKind })} style={{ ...inputStyle, width: 72 }}>
                            {SUBJECT_KINDS.map((item) => (
                                <option key={item.value} value={item.value}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <textarea value={subject.description} placeholder="简短描述，如：短发、米色风衣" onChange={(e) => ctx.updateMetadata({ subjectDescription: e.target.value })} onWheel={stop} rows={2} style={{ ...inputStyle, resize: "none" }} />

                    {/* 参考图:最多 4 张,悬停右上角可移除 */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, flex: 1, minHeight: 0, alignContent: "start" }}>
                        {subject.images.map((url, index) => (
                            <div key={url} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", background: theme.node.placeholder }}>
                                <img src={url} alt={`参考图 ${index + 1}`} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                <button
                                    type="button"
                                    title="移除"
                                    onClick={() => setImages(subject.images.filter((item) => item !== url))}
                                    style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, lineHeight: "16px", padding: 0, borderRadius: "50%", border: "none", background: theme.toolbar.panel, color: theme.node.text, cursor: "pointer", fontSize: 12 }}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        {subject.images.length === 0 ? <div style={{ gridColumn: "1 / -1", color: theme.node.muted, padding: "12px 0", textAlign: "center" }}>上传或从上游取 1–4 张参考图</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" style={buttonStyle} onClick={() => fileInputRef.current?.click()}>
                            上传图片
                        </button>
                        <button type="button" style={buttonStyle} onClick={pullUpstream}>
                            从上游取图
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: "none" }}
                            onChange={(e) => {
                                void onFiles(e.target.files);
                                e.target.value = "";
                            }}
                        />
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: theme.node.muted }}>
                        <input type="checkbox" checked={appendDescription} onChange={(e) => ctx.updateMetadata({ appendDescription: e.target.checked })} />
                        描述拼进提示词
                    </label>

                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button type="button" style={primaryStyle} onClick={() => void saveToLibrary()}>
                            存入主体库
                        </button>
                        <button type="button" style={buttonStyle} onClick={() => void openLibrary()}>
                            从库中选择
                        </button>
                    </div>
                </div>
            )}

            {hint ? <div style={{ color: theme.node.muted, fontSize: 11 }}>{hint}</div> : null}
        </div>
    );
}

export default definePlugin({
    id: "subject",
    name: "主体节点",
    version: "1.0.0",
    description: "保存角色或商品参考图，跨画布复用",
    nodes: [
        {
            type: "subject:node",
            title: DEFAULT_SUBJECT_NAME,
            icon: "👤",
            description: "角色或商品的参考图集合",
            defaultSize: { width: 320, height: 360 },
            defaultMetadata: { subjectName: "", subjectKind: "character", subjectDescription: "", subjectImages: [], appendDescription: false },
            minimapColor: "#0ea5e9",
            // 纯资料节点:不弹出内置生成面板
            hidePanel: true,
            resource: (node) => buildSubjectResource(node.metadata),
            Content: SubjectContent,
        },
    ],
});
