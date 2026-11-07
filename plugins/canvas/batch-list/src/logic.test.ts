import { describe, expect, test } from "bun:test";
import { comboTitle, expandCombinations, fillTemplate, runWithConcurrency, validateVariableName } from "./logic";

describe("expandCombinations", () => {
    test("2 变量各 3 值 → 9 个组合,首个为两变量的首值", () => {
        const combos = expandCombinations([
            { name: "a", values: ["a1", "a2", "a3"] },
            { name: "b", values: ["b1", "b2", "b3"] },
        ]);
        expect(combos).toHaveLength(9);
        expect(combos[0]).toEqual({ a: "a1", b: "b1" });
        expect(combos[1]).toEqual({ a: "a1", b: "b2" });
        expect(combos[8]).toEqual({ a: "a3", b: "b3" });
    });

    test("空字符串值被忽略", () => {
        const combos = expandCombinations([
            { name: "a", values: ["a1", "", "  ", "a2"] },
            { name: "b", values: ["b1"] },
        ]);
        expect(combos).toEqual([
            { a: "a1", b: "b1" },
            { a: "a2", b: "b1" },
        ]);
    });

    test("无变量 → [{}]", () => {
        expect(expandCombinations([])).toEqual([{}]);
    });

    test("某变量没有有效值时不参与展开", () => {
        expect(expandCombinations([{ name: "a", values: ["x"] }, { name: "b", values: [""] }])).toEqual([{ a: "x" }]);
    });
});

describe("fillTemplate", () => {
    test("未定义的变量名保持原样", () => {
        expect(fillTemplate("{a} 穿 {b} 在 {c}", { a: "模特", b: "西装" })).toBe("模特 穿 西装 在 {c}");
    });
});

describe("comboTitle", () => {
    test("组合值以「 / 」连接", () => {
        expect(comboTitle({ a: "模特", b: "西装" })).toBe("模特 / 西装");
    });
});

describe("validateVariableName", () => {
    test("非空且唯一", () => {
        expect(validateVariableName("", [])).toBe("变量名不能为空");
        expect(validateVariableName("a", ["a"])).toBe("变量名已存在");
        expect(validateVariableName(" b ", ["a"])).toBeNull();
    });
});

describe("runWithConcurrency", () => {
    test("同时最多 limit 个任务", async () => {
        let running = 0;
        let peak = 0;
        const done: number[] = [];
        const tasks = Array.from({ length: 7 }, (_, index) => async () => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            running -= 1;
            done.push(index);
        });
        await runWithConcurrency(tasks, 3);
        expect(peak).toBe(3);
        expect(done.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
});
