// 分镜脚本节点的纯逻辑:解析模型输出的分镜 JSON、拼镜头提示词、重排镜号、限并发执行。
// 不依赖浏览器与宿主,便于单元测试。

export type StoryboardRow = {
    id: string;
    shot: number;
    seconds: number;
    framing: string;
    description: string;
    subject: string;
    imageNodeId?: string;
};

export const DEFAULT_SECONDS = 5;

// 拆分镜时给文本模型的系统提示词:只输出 JSON 数组
export const SPLIT_SYSTEM_PROMPT = [
    "你是专业的影视分镜师。把用户给出的剧本拆成分镜表。",
    "只输出一个 JSON 数组,不要输出任何解释或其它文字。",
    '数组每一项是一个对象,字段为:shot(镜号,整数,从 1 开始)、seconds(时长秒数,整数)、framing(景别,如远景/全景/中景/近景/特写)、description(画面描述,写清动作、场景、光线、镜头运动)、subject(该镜出现的角色或主体)。',
].join("\n");

let idSeed = 0;

/** 生成行 id(同一会话内唯一) */
export function newRowId(): string {
    idSeed += 1;
    return `shot-${Date.now().toString(36)}-${idSeed.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 时长取正数,缺失或非数字时默认 5 */
export function toSeconds(value: unknown): number {
    const num = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(num) && num > 0 ? num : DEFAULT_SECONDS;
}

/** 解析模型输出为分镜行;容忍 ```json 代码块与前后多余文字,失败时抛错 */
export function parseStoryboard(text: string): StoryboardRow[] {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1] : text;
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("分镜解析失败:未找到 JSON 数组");
    const data: unknown = JSON.parse(body.slice(start, end + 1));
    if (!Array.isArray(data)) throw new Error("分镜解析失败:结果不是数组");
    return data.map((item, index) => {
        const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
            id: newRowId(),
            shot: index + 1,
            seconds: toSeconds(record.seconds),
            framing: asText(record.framing),
            description: asText(record.description),
            subject: asText(record.subject),
        };
    });
}

/** 单镜提示词:景别 + 画面描述 + 主体 */
export function buildShotPrompt(row: StoryboardRow): string {
    return [row.framing && `景别：${row.framing}`, row.description && `画面：${row.description}`, row.subject && `主体：${row.subject}`].filter(Boolean).join("。");
}

/** 镜号按行序重排为 1..N */
export function renumberRows(rows: StoryboardRow[]): StoryboardRow[] {
    return rows.map((row, index) => (row.shot === index + 1 ? row : { ...row, shot: index + 1 }));
}

/** 新建空行 */
export function createRow(): StoryboardRow {
    return { id: newRowId(), shot: 0, seconds: DEFAULT_SECONDS, framing: "", description: "", subject: "" };
}

/** 限并发逐个执行;单个任务的异常由 worker 自行处理 */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const lanes = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
        while (next < items.length) {
            const item = items[next];
            next += 1;
            await worker(item);
        }
    });
    await Promise.all(lanes);
}

function asText(value: unknown): string {
    return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}
