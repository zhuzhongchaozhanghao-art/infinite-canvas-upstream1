import { describe, expect, test } from "bun:test";
import { clampPercent, normalizeMode, percentFromPointer, pickPair } from "./logic";

describe("clampPercent", () => {
    test("限制在 0–100", () => {
        expect(clampPercent(-5)).toBe(0);
        expect(clampPercent(130)).toBe(100);
        expect(clampPercent(42)).toBe(42);
    });
    test("非数字回退到 50", () => {
        expect(clampPercent(Number.NaN)).toBe(50);
    });
});

describe("percentFromPointer", () => {
    test("按指针在容器内的横向位置换算百分比", () => {
        expect(percentFromPointer(150, 100, 200)).toBe(25);
        expect(percentFromPointer(50, 100, 200)).toBe(0);
        expect(percentFromPointer(400, 100, 200)).toBe(100);
    });
    test("容器宽度为 0 时回退到 50", () => {
        expect(percentFromPointer(10, 0, 0)).toBe(50);
    });
});

describe("normalizeMode", () => {
    test("只认 side,其余都是 slider", () => {
        expect(normalizeMode("side")).toBe("side");
        expect(normalizeMode("slider")).toBe("slider");
        expect(normalizeMode(undefined)).toBe("slider");
        expect(normalizeMode("other")).toBe("slider");
    });
});

describe("pickPair", () => {
    test("取前两张", () => {
        expect(pickPair(["a", "b", "c"])).toEqual(["a", "b"]);
    });
    test("不足两张返回 null", () => {
        expect(pickPair(["a"])).toBeNull();
        expect(pickPair([])).toBeNull();
    });
});
