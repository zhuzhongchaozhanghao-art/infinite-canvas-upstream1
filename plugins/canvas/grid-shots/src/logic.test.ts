import { describe, expect, test } from "bun:test";
import { buildGridPrompt, GRID_PRESETS, tileRects } from "./logic";

describe("tileRects", () => {
    test("900×900 切 3×3 得到 9 个 300×300,第 5 个在 (300,300)", () => {
        const rects = tileRects(900, 900, 3, 3);
        expect(rects).toHaveLength(9);
        expect(rects.every((rect) => rect.width === 300 && rect.height === 300)).toBe(true);
        expect(rects[4]).toEqual({ x: 300, y: 300, width: 300, height: 300 });
    });

    test("1000×300 切 1×3,余数补给最后一列", () => {
        const rects = tileRects(1000, 300, 1, 3);
        expect(rects.map((rect) => rect.width)).toEqual([333, 333, 334]);
        expect(rects.reduce((sum, rect) => sum + rect.width, 0)).toBe(1000);
        expect(rects.map((rect) => rect.x)).toEqual([0, 333, 666]);
    });
});

describe("GRID_PRESETS", () => {
    test("4 个预设的格数分别为 9、4、3、25", () => {
        const ids = ["multi-angle-9", "story-4", "turnaround-3", "storyboard-25"] as const;
        expect(ids.map((id) => GRID_PRESETS[id].rows * GRID_PRESETS[id].columns)).toEqual([9, 4, 3, 25]);
    });

    test("每个预设提示词都要求等分网格、无边框无间隙、主体一致", () => {
        for (const preset of Object.values(GRID_PRESETS)) {
            expect(preset.prompt).toContain("等分网格");
            expect(preset.prompt).toContain("无边框无间隙");
            expect(preset.prompt).toContain("主体一致");
        }
    });
});

describe("buildGridPrompt", () => {
    test("自定义补充描述拼在预设提示词后", () => {
        const prompt = buildGridPrompt("story-4", "  雨夜街头  ");
        expect(prompt.startsWith(GRID_PRESETS["story-4"].prompt)).toBe(true);
        expect(prompt.endsWith("雨夜街头")).toBe(true);
    });

    test("补充描述为空时只用预设提示词", () => {
        expect(buildGridPrompt("multi-angle-9", "  ")).toBe(GRID_PRESETS["multi-angle-9"].prompt);
    });
});
