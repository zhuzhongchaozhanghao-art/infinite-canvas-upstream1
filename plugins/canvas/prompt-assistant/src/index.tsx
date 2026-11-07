// 提示词助手节点:读取上游文本与图片,按预设模式(扩写/精简/翻译/服装描述/自定义)调用文本模型,
// 结果存 metadata.content,可直接编辑,并作为文本资源供下游生成节点使用。
import { definePlugin, getUpstreamImages, getUpstreamText, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";
import { ASSISTANT_MODES, IMAGE_ONLY_PROMPT, buildAssistantRequest, canGenerate } from "./logic";
import type { AssistantMode } from "./logic";

function PromptAssistantContent({ ctx }: CanvasNodeContentProps) {
    const meta = ctx.node.metadata || {};
    const content = meta.content || "";
    const mode = (meta.assistantMode as AssistantMode | undefined) || "expand";
    const note = (meta.assistantNote as string | undefined) || "";
    const customSystem = (meta.assistantSystem as string | undefined) || "";
    const models = ctx.ai.listModels("text");
    const model = (meta.assistantModel as string | undefined) || ctx.ai.defaultModel("text");

    const [generating, setGenerating] = useState(false);
    // 流式生成中的临时结果:只在本组件内刷新,完成后再一次性写入 metadata
    const [draft, setDraft] = useState("");
    const [error, setError] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    // 节点卸载时取消进行中的请求
    useEffect(() => () => abortRef.current?.abort(), []);

    const upstreamText = getUpstreamText(ctx);
    const upstreamImages = getUpstreamImages(ctx);
    const enabled = canGenerate(upstreamText, upstreamImages.length, note);

    const generate = async () => {
        if (generating || !enabled) return;
        const { system, prompt } = buildAssistantRequest(mode, upstreamText, note, customSystem);
        const controller = new AbortController();
        abortRef.current = controller;
        setGenerating(true);
        setDraft("");
        setError("");
        try {
            const result = await ctx.ai.generateText(prompt || IMAGE_ONLY_PROMPT, {
                system: system || undefined,
                images: upstreamImages.length ? upstreamImages : undefined,
                model: model || undefined,
                signal: controller.signal,
                // 宿主回传的是累计文本,直接覆盖临时结果
                onDelta: (text) => setDraft(text),
            });
            if (!controller.signal.aborted) ctx.updateMetadata({ content: result.text });
        } catch (err) {
            // 失败或取消都保留旧结果;取消不提示错误
            if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setGenerating(false);
            setDraft("");
        }
    };

    const cancel = () => abortRef.current?.abort();

    const theme = ctx.theme;
    const field = { padding: "4px 8px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.node.panel, color: theme.node.text, fontSize: 12, outline: "none", boxSizing: "border-box" } as const;
    const btn = { padding: "4px 12px", borderRadius: 8, border: `1px solid ${theme.node.stroke}`, background: theme.toolbar.panel, color: theme.node.text, cursor: "pointer", fontSize: 12 } as const;
    const primaryBtn = { ...btn, background: theme.toolbar.activeBg, color: theme.toolbar.activeText, border: `1px solid ${theme.toolbar.activeBg}`, opacity: enabled ? 1 : 0.5, cursor: enabled ? "pointer" : "not-allowed" } as const;

    return (
        // 空白区域交给画布拖动节点，仅交互控件阻止拖动。
        <div data-canvas-no-zoom onMouseDown={(e) => {
            if (e.target instanceof Element && e.target.closest("input, textarea, select, button")) e.stopPropagation();
        }} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, boxSizing: "border-box", color: theme.node.text, fontSize: 12 }}>
            <div style={{ display: "flex", gap: 6 }}>
                <select value={mode} disabled={generating} onChange={(e) => ctx.updateMetadata({ assistantMode: e.target.value })} style={{ ...field, flex: "0 0 auto" }}>
                    {ASSISTANT_MODES.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>
                <select value={model} disabled={generating || !models.length} onChange={(e) => ctx.updateMetadata({ assistantModel: e.target.value })} style={{ ...field, flex: 1, minWidth: 0 }}>
                    {models.length ? (
                        models.map((item) => (
                            <option key={item.value} value={item.value}>
                                {item.label}
                            </option>
                        ))
                    ) : (
                        <option value="">未配置文本模型</option>
                    )}
                </select>
            </div>
            {mode === "custom" ? (
                <textarea value={customSystem} disabled={generating} placeholder="系统提示词:描述你希望模型怎样处理输入…" onChange={(e) => ctx.updateMetadata({ assistantSystem: e.target.value })} onWheel={(e) => e.stopPropagation()} rows={2} style={{ ...field, resize: "none", lineHeight: 1.5 }} />
            ) : null}
            <input value={note} disabled={generating} placeholder="补充说明(可选)" onChange={(e) => ctx.updateMetadata({ assistantNote: e.target.value })} style={field} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ flex: 1, color: theme.node.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    上游:文本 {upstreamText ? `${upstreamText.length} 字` : "无"} · 图片 {upstreamImages.length} 张
                </span>
                {generating ? (
                    <button type="button" style={btn} onClick={cancel}>
                        取消
                    </button>
                ) : (
                    <button type="button" style={primaryBtn} disabled={!enabled} title={enabled ? undefined : "连入文本或图片,或填写补充说明"} onClick={generate}>
                        {content ? "重新生成" : "生成"}
                    </button>
                )}
            </div>
            {error ? <div style={{ padding: "4px 8px", borderRadius: 8, border: `1px solid ${theme.node.activeStroke}`, color: theme.node.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>生成失败:{error}</div> : null}
            <textarea
                value={generating ? draft : content}
                readOnly={generating}
                placeholder={generating ? "生成中…" : "生成结果会显示在这里,可直接编辑"}
                onChange={(e) => ctx.updateMetadata({ content: e.target.value })}
                onWheel={(e) => e.stopPropagation()}
                style={{ ...field, flex: 1, minHeight: 0, resize: "none", fontSize: 13, lineHeight: 1.5 }}
            />
        </div>
    );
}

export default definePlugin({
    id: "prompt-assistant",
    name: "提示词助手节点",
    version: "1.0.0",
    description: "扩写、精简、翻译、服装描述,支持看图",
    nodes: [
        {
            type: "prompt-assistant:node",
            title: "提示词助手",
            icon: "🪄",
            description: "扩写、精简、翻译、服装描述,支持看图",
            defaultSize: { width: 360, height: 320 },
            defaultMetadata: { content: "", assistantMode: "expand", assistantNote: "", assistantSystem: "" },
            minimapColor: "#a855f7",
            // 有结果时才作为文本资源输出给下游
            resource: (node) => (node.metadata?.content ? { kind: "text", text: node.metadata.content } : null),
            Content: PromptAssistantContent,
        },
    ],
});
