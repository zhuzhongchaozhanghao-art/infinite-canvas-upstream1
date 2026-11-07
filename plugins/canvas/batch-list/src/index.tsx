// 列表批量节点:变量表 × 提示词模板做笛卡尔积,批量调用宿主生图,结果铺成图片节点网格并连线。
import { buildImageNodeOps, definePlugin, getUpstreamImages, gridPositions, readImageSize, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext, Position } from "@infinite-canvas/plugin-sdk";
import { comboTitle, expandCombinations, fillTemplate, runWithConcurrency, validateVariableName } from "./logic";
import type { BatchVariable } from "./logic";

type Combo = Record<string, string>;
// 一条生成任务:第 comboIndex 个组合
type BatchJob = { comboIndex: number; combo: Combo };
type BatchFailure = BatchJob & { error: string };
// 一次运行的网格布局:重试时沿用,保证结果落在原来的格子
type BatchLayout = { origin: Position; total: number; count: number; cellHeight: number };

const CONCURRENCY = 3;
const CONFIRM_THRESHOLD = 50;
const CELL_WIDTH = 240;
const RESULT_OFFSET_X = 80;
// 尺寸选项:value 直接传给 ai.generateImage({ size });空串表示用宿主当前配置
const SIZE_OPTIONS = [
    { value: "", label: "默认尺寸" },
    { value: "1024x1024", label: "1:1" },
    { value: "768x1024", label: "3:4" },
    { value: "1024x768", label: "4:3" },
    { value: "1024x1536", label: "2:3" },
    { value: "1536x1024", label: "3:2" },
    { value: "864x1536", label: "9:16" },
    { value: "1536x864", label: "16:9" },
];

// 按尺寸字符串推算单元格高度;未指定尺寸时返回 0,由首张结果决定
function cellHeightFromSize(size: string) {
    const match = size.match(/^(\d+)x(\d+)$/);
    return match ? Math.round((CELL_WIDTH * Number(match[2])) / Number(match[1])) : 0;
}

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error || "生成失败");
}

function BatchListContent({ ctx }: CanvasNodeContentProps) {
    // 异步任务里始终用最新 ctx,避免闭包拿到旧节点数据
    const ctxRef = useRef<CanvasNodeContext>(ctx);
    ctxRef.current = ctx;
    const metadata = ctx.node.metadata || {};
    const variables = (metadata.variables as BatchVariable[] | undefined) || [];
    const template = (metadata.template as string | undefined) || "";
    const models = ctx.ai.listModels("image");
    const model = (metadata.batchModel as string | undefined) ?? ctx.ai.defaultModel("image");
    const size = (metadata.batchSize as string | undefined) || "";
    const count = Math.min(4, Math.max(1, Number(metadata.batchCount) || 1));
    const combos = expandCombinations(variables);
    const total = combos.length * count;

    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [nameErrors, setNameErrors] = useState<Record<number, string>>({});
    const abortRef = useRef<AbortController | null>(null);
    // 运行序号:取消后立刻重跑时,旧批次收尾不能改动新批次的状态
    const runIdRef = useRef(0);
    // 失败列表并发写入,用 ref 作为真源再同步到 metadata
    const failuresRef = useRef<BatchFailure[]>((metadata.batchFailures as BatchFailure[] | undefined) || []);
    const failures = (metadata.batchFailures as BatchFailure[] | undefined) || [];

    useEffect(() => () => abortRef.current?.abort(), []);

    const t = ctx.theme;
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
    const input = { boxSizing: "border-box", border: `1px solid ${t.node.stroke}`, borderRadius: 8, background: t.node.panel, color: t.node.text, fontSize: 12, padding: "4px 6px", outline: "none", fontFamily: "inherit" } as const;
    const btn = { padding: "4px 10px", borderRadius: 8, border: `1px solid ${t.node.stroke}`, background: t.toolbar.panel, color: t.node.text, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" } as const;
    const primaryBtn = { ...btn, background: t.toolbar.activeBg, color: t.toolbar.activeText, border: `1px solid ${t.toolbar.activeBg}` } as const;
    const label = { fontSize: 12, color: t.node.muted } as const;

    const setVariables = (next: BatchVariable[]) => ctx.updateMetadata({ variables: next });

    const addVariable = () => {
        const names = variables.map((item) => item.name);
        let index = variables.length + 1;
        while (names.includes(`变量${index}`)) index += 1;
        setVariables([...variables, { name: `变量${index}`, values: [""] }]);
    };

    const renameVariable = (index: number, name: string) => {
        const error = validateVariableName(name, variables.filter((_, i) => i !== index).map((item) => item.name));
        setNameErrors((prev) => {
            const next = { ...prev };
            if (error) next[index] = error;
            else delete next[index];
            return next;
        });
        if (!error) setVariables(variables.map((item, i) => (i === index ? { ...item, name: name.trim() } : item)));
        return !error;
    };

    const removeVariable = (index: number) => {
        setNameErrors({});
        setVariables(variables.filter((_, i) => i !== index));
    };

    const setFailures = (next: BatchFailure[]) => {
        failuresRef.current = next;
        ctxRef.current.updateMetadata({ batchFailures: next });
    };

    // 跑一批任务:并发 3,每完成一条立即铺图并连线;失败记入列表,取消时静默结束
    const runJobs = async (jobs: BatchJob[], layout: BatchLayout) => {
        const controller = new AbortController();
        abortRef.current = controller;
        const runId = (runIdRef.current += 1);
        const { signal } = controller;
        const references = getUpstreamImages(ctxRef.current);
        const prompt = template;
        const options = { model: model || undefined, size: size || undefined, count: layout.count, references: references.length ? references : undefined, signal };
        const stamp = Date.now().toString(36);
        let done = 0;
        setRunning(true);
        setProgress({ done: 0, total: jobs.length });

        const tasks = jobs.map((job) => async () => {
            if (signal.aborted) return;
            try {
                const { images } = await ctxRef.current.ai.generateImage(fillTemplate(prompt, job.combo), options);
                if (signal.aborted) return;
                if (!images.length) throw new Error("模型未返回图片");
                for (const [j, dataUrl] of images.slice(0, layout.count).entries()) {
                    const natural = await readImageSize(dataUrl).catch(() => ({ width: 1024, height: 1024 }));
                    // 未指定尺寸时,以首张结果的比例确定整批行高
                    if (!layout.cellHeight) layout.cellHeight = Math.round((CELL_WIDTH * natural.height) / Math.max(1, natural.width));
                    const position = gridPositions(layout.origin, layout.total, { width: CELL_WIDTH, height: layout.cellHeight })[job.comboIndex * layout.count + j];
                    if (!position) continue;
                    const item = { id: `${ctxRef.current.node.id}-batch-${stamp}-${job.comboIndex}-${j}`, title: comboTitle(job.combo) || "列表批量", dataUrl, width: natural.width, height: natural.height };
                    ctxRef.current.applyOps(buildImageNodeOps(ctxRef.current.node.id, [item], position, { cellWidth: CELL_WIDTH }));
                }
                setFailures(failuresRef.current.filter((failure) => failure.comboIndex !== job.comboIndex));
            } catch (error) {
                if (signal.aborted) return;
                setFailures([...failuresRef.current.filter((failure) => failure.comboIndex !== job.comboIndex), { ...job, error: errorText(error) }]);
            } finally {
                if (!signal.aborted) setProgress({ done: (done += 1), total: jobs.length });
            }
        });

        await runWithConcurrency(tasks, CONCURRENCY);
        if (runIdRef.current !== runId) return;
        if (abortRef.current === controller) abortRef.current = null;
        setRunning(false);
        // 记录本批布局(含首张结果确定的行高),供单条重试沿用
        ctxRef.current.updateMetadata({ batchLayout: layout });
    };

    const runAll = () => {
        if (running || !template.trim()) return;
        if (total > CONFIRM_THRESHOLD && !window.confirm(`将生成 ${total} 张，确定继续？`)) return;
        const node = ctxRef.current.node;
        const layout: BatchLayout = { origin: { x: node.position.x + node.width + RESULT_OFFSET_X, y: node.position.y }, total, count, cellHeight: cellHeightFromSize(size) };
        setFailures([]);
        void runJobs(combos.map((combo, comboIndex) => ({ comboIndex, combo })), layout);
    };

    const retry = (failure: BatchFailure) => {
        if (running) return;
        const node = ctxRef.current.node;
        const stored = metadata.batchLayout as BatchLayout | undefined;
        const layout: BatchLayout = stored ? { ...stored } : { origin: { x: node.position.x + node.width + RESULT_OFFSET_X, y: node.position.y }, total, count, cellHeight: cellHeightFromSize(size) };
        void runJobs([{ comboIndex: failure.comboIndex, combo: failure.combo }], layout);
    };

    const cancel = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setRunning(false);
    };

    return (
        <div data-canvas-no-zoom onMouseDown={(e) => {
            if (e.target instanceof Element && e.target.closest("input, textarea, select, button")) e.stopPropagation();
        }} onWheel={stop} onDoubleClick={stop} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, boxSizing: "border-box", color: t.node.text, fontSize: 12, overflow: "hidden" }}>
            {/* 变量表:每列一个变量,取值一行一个 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={label}>变量（每行一个取值）</span>
                <button type="button" style={btn} onClick={addVariable} disabled={running}>
                    + 变量
                </button>
            </div>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", minHeight: 120, flex: "1 1 140px" }}>
                {variables.length ? (
                    variables.map((variable, index) => (
                        <VariableColumn
                            key={index}
                            variable={variable}
                            error={nameErrors[index]}
                            disabled={running}
                            inputStyle={input}
                            btnStyle={btn}
                            mutedColor={t.node.muted}
                            onRename={(name) => renameVariable(index, name)}
                            onValues={(values) => setVariables(variables.map((item, i) => (i === index ? { ...item, values } : item)))}
                            onRemove={() => removeVariable(index)}
                        />
                    ))
                ) : (
                    <div style={{ ...label, alignSelf: "center", width: "100%", textAlign: "center", color: t.node.faint }}>暂无变量，模板将原样生成</div>
                )}
            </div>

            {/* 提示词模板 */}
            <span style={label}>提示词模板（用 {"{变量名}"} 引用变量）</span>
            <textarea value={template} disabled={running} placeholder="例如：{人物} 穿 {服装} 站在 {场景}" onChange={(e) => ctx.updateMetadata({ template: e.target.value })} style={{ ...input, resize: "none", height: 64, flex: "0 0 auto" }} />

            {/* 生成设置 */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <select value={model} disabled={running} onChange={(e) => ctx.updateMetadata({ batchModel: e.target.value })} style={{ ...input, maxWidth: 180 }}>
                    {models.length ? null : <option value="">默认模型</option>}
                    {models.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <select value={size} disabled={running} onChange={(e) => ctx.updateMetadata({ batchSize: e.target.value })} style={input}>
                    {SIZE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <select value={count} disabled={running} onChange={(e) => ctx.updateMetadata({ batchCount: Number(e.target.value) })} style={input}>
                    {[1, 2, 3, 4].map((value) => (
                        <option key={value} value={value}>
                            每条 {value} 张
                        </option>
                    ))}
                </select>
                <span style={{ marginLeft: "auto", color: t.node.muted }}>将生成 {total} 张</span>
                {running ? (
                    <button type="button" style={btn} onClick={cancel}>
                        取消
                    </button>
                ) : (
                    <button type="button" style={{ ...primaryBtn, opacity: template.trim() ? 1 : 0.5, cursor: template.trim() ? "pointer" : "not-allowed" }} disabled={!template.trim()} onClick={runAll}>
                        运行
                    </button>
                )}
            </div>

            {running ? <div style={{ color: t.node.muted }}>生成中 {progress.done} / {progress.total}</div> : null}

            {/* 失败条目:可单条重试 */}
            {failures.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 96, overflowY: "auto", flex: "0 0 auto" }}>
                    <span style={label}>失败 {failures.length} 条</span>
                    {failures.map((failure) => (
                        <div key={failure.comboIndex} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={failure.error}>
                                {comboTitle(failure.combo) || "模板原样"}：{failure.error}
                            </span>
                            <button type="button" style={btn} disabled={running} onClick={() => retry(failure)}>
                                重试
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

type VariableColumnProps = {
    variable: BatchVariable;
    error?: string;
    disabled: boolean;
    inputStyle: Record<string, string | number>;
    btnStyle: Record<string, string | number>;
    mutedColor: string;
    onRename: (name: string) => boolean;
    onValues: (values: string[]) => void;
    onRemove: () => void;
};

// 单个变量列:列名本地草稿,失焦时校验(非空、唯一)后提交
function VariableColumn({ variable, error, disabled, inputStyle, btnStyle, mutedColor, onRename, onValues, onRemove }: VariableColumnProps) {
    const [draftName, setDraftName] = useState(variable.name);
    useEffect(() => setDraftName(variable.name), [variable.name]);
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 140px", minWidth: 140 }}>
            <div style={{ display: "flex", gap: 4 }}>
                <input
                    value={draftName}
                    disabled={disabled}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => onRename(draftName)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    style={{ ...inputStyle, flex: 1, minWidth: 0, fontWeight: 600 }}
                />
                <button type="button" title="删除变量" style={{ ...btnStyle, padding: "2px 8px" }} disabled={disabled} onClick={onRemove}>
                    ×
                </button>
            </div>
            {error ? <span style={{ fontSize: 11, color: mutedColor }}>{error}</span> : null}
            <textarea value={variable.values.join("\n")} disabled={disabled} placeholder={"取值一\n取值二"} onChange={(e) => onValues(e.target.value.split("\n"))} style={{ ...inputStyle, flex: 1, resize: "none", minHeight: 60 }} />
        </div>
    );
}

export default definePlugin({
    id: "batch-list",
    name: "列表批量节点",
    version: "1.0.0",
    description: "变量组合批量出图",
    nodes: [
        {
            type: "batch-list:node",
            title: "列表批量",
            icon: "📋",
            description: "变量组合批量出图",
            defaultSize: { width: 520, height: 420 },
            defaultMetadata: { variables: [], template: "" },
            minimapColor: "#6366f1",
            // 节点内自带全部设置与运行按钮,不弹出宿主生成面板
            hidePanel: true,
            Content: BatchListContent,
        },
    ],
});
