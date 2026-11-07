// 提示词助手的纯逻辑:按模式拼装系统提示词与用户提示词(不依赖运行时,便于单测)。

export type AssistantMode = "expand" | "condense" | "translate-en" | "garment" | "custom";

export const ASSISTANT_MODES: { value: AssistantMode; label: string }[] = [
    { value: "expand", label: "扩写" },
    { value: "condense", label: "精简" },
    { value: "translate-en", label: "翻译成英文" },
    { value: "garment", label: "服装描述" },
    { value: "custom", label: "自定义" },
];

// 公共输出约束:只输出结果本身,方便直接连给下游生成节点使用
const OUTPUT_RULE = "只输出最终结果文本,不要解释、不要标题、不要使用 Markdown 代码块。";

const MODE_SYSTEMS: Record<Exclude<AssistantMode, "custom">, string> = {
    expand: `你是 AI 生图提示词专家。把用户提供的内容(以及参考图片,如有)扩写成一段画面完整、细节丰富的生图提示词,补充主体、场景、构图、光线、色调与风格。${OUTPUT_RULE}`,
    condense: `你是 AI 生图提示词专家。把用户提供的内容精简为简洁有力的生图提示词,保留主体与关键视觉要素,去掉冗余修饰。${OUTPUT_RULE}`,
    "translate-en": `你是专业翻译。把用户提供的内容翻译成自然、地道的英文生图提示词,保留全部视觉细节;若已是英文则润色。${OUTPUT_RULE}`,
    garment: `你是资深服装设计师。根据用户提供的内容与参考图片,描述其中的服装,严格按以下四项分行输出:\n款式:\n面料:\n颜色:\n细节:\n每项用一两句具体、可用于生图的描述。${OUTPUT_RULE}`,
};

/** 拼装一次生成请求;上游文本与补充说明都为空时 prompt 为空字符串 */
export function buildAssistantRequest(mode: AssistantMode, upstreamText: string, note: string, customSystem?: string): { system: string; prompt: string } {
    const system = mode === "custom" ? (customSystem ?? "").trim() : MODE_SYSTEMS[mode];
    const text = upstreamText.trim();
    const extra = note.trim();
    const parts: string[] = [];
    if (text) parts.push(`内容:\n${text}`);
    if (extra) parts.push(`补充说明:\n${extra}`);
    return { system, prompt: parts.join("\n\n") };
}

/** 没有任何输入(上游文本、图片、补充说明)时不可生成 */
export function canGenerate(upstreamText: string, imageCount: number, note: string): boolean {
    return Boolean(upstreamText.trim() || note.trim() || imageCount > 0);
}

// 只有图片、没有文字输入时的兜底提示词(多数接口不接受空的用户文本)
export const IMAGE_ONLY_PROMPT = "请根据参考图片完成任务。";
