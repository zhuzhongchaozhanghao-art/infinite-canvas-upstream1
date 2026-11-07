// 宫格节点纯逻辑:预设、提示词拼接、大图切分矩形。不依赖浏览器与宿主,便于单测。

export type GridPresetId = "multi-angle-9" | "story-4" | "turnaround-3" | "storyboard-25";

export type GridPreset = { label: string; rows: number; columns: number; prompt: string };

export type TileRect = { x: number; y: number; width: number; height: number };

// 所有预设共用的版式约束,保证生成后能按等分矩形切开
const LAYOUT_RULE = "画面严格等分网格排列,各格大小完全相同,无边框无间隙、无文字无编号,主体一致(同一人物/商品的外貌、服装、配色在每一格保持一致)。";

export const GRID_PRESETS: Record<GridPresetId, GridPreset> = {
    "multi-angle-9": {
        label: "九宫格多机位",
        rows: 3,
        columns: 3,
        prompt: `生成一张 3×3 九宫格图片,以参考图主体为对象,9 格分别为不同机位与景别(正面、侧面、背面、俯拍、仰拍、特写、半身、全身、远景)。${LAYOUT_RULE}`,
    },
    "story-4": {
        label: "四宫格剧情推演",
        rows: 2,
        columns: 2,
        prompt: `生成一张 2×2 四宫格图片,按从左到右、从上到下的顺序讲述一个连贯的 4 幕剧情(起、承、转、合),以参考图主体为主角。${LAYOUT_RULE}`,
    },
    "turnaround-3": {
        label: "角色三视图",
        rows: 1,
        columns: 3,
        prompt: `生成一张 1×3 横向三视图,从左到右依次为主体的正面、侧面、背面全身视图,纯色背景,姿态站立中立。${LAYOUT_RULE}`,
    },
    "storyboard-25": {
        label: "25 宫格连贯分镜",
        rows: 5,
        columns: 5,
        prompt: `生成一张 5×5 共 25 格的连贯分镜图,按从左到右、从上到下的顺序表现同一场景中连续的动作与镜头变化,以参考图主体为主角。${LAYOUT_RULE}`,
    },
};

export const GRID_PRESET_IDS = Object.keys(GRID_PRESETS) as GridPresetId[];

/** 预设提示词 + 自定义补充描述(补充为空时只用预设) */
export function buildGridPrompt(presetId: GridPresetId, note: string): string {
    const base = GRID_PRESETS[presetId].prompt;
    const extra = note.trim();
    return extra ? `${base}\n${extra}` : base;
}

/** 把 width×height 的大图按 rows×columns 等分,行优先;除不尽的余数补给最后一行/列 */
export function tileRects(width: number, height: number, rows: number, columns: number): TileRect[] {
    const xs = splitEdges(width, columns);
    const ys = splitEdges(height, rows);
    return ys.flatMap((y) => xs.map((x) => ({ x: x.start, y: y.start, width: x.size, height: y.size })));
}

function splitEdges(total: number, parts: number) {
    const size = Math.floor(total / parts);
    return Array.from({ length: parts }, (_, index) => ({
        start: index * size,
        size: index === parts - 1 ? total - size * (parts - 1) : size,
    }));
}
