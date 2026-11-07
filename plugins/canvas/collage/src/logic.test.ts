import { describe, expect, test } from "bun:test";
import { applyOrder, computeCollageLayout, fitImage, moveKey } from "./logic";

const square = { width: 100, height: 100 };

describe("computeCollageLayout", () => {
    test("4 张 100×100、2 列、gap 10、1:1、cellWidth 100", () => {
        const layout = computeCollageLayout([square, square, square, square], { columns: 2, gap: 10, cellRatio: "1:1", cellWidth: 100 });
        expect(layout.width).toBe(210);
        expect(layout.height).toBe(210);
        expect(layout.cells[3]).toEqual({ x: 110, y: 110, width: 100, height: 100 });
    });

    test("3 张、2 列 → 2 行,第 3 格在第二行第一列", () => {
        const layout = computeCollageLayout([square, square, square], { columns: 2, gap: 10, cellRatio: "1:1", cellWidth: 100 });
        expect(layout.height).toBe(210);
        expect(layout.cells[2]).toEqual({ x: 0, y: 110, width: 100, height: 100 });
    });

    test("0 张 → 宽高 0、cells 为空", () => {
        expect(computeCollageLayout([], { columns: 2, gap: 10, cellRatio: "1:1", cellWidth: 100 })).toEqual({ width: 0, height: 0, cells: [] });
    });

    test("按原图:行高取该行最高图按 cellWidth 缩放后的高度", () => {
        const layout = computeCollageLayout([{ width: 200, height: 100 }, { width: 100, height: 200 }, { width: 100, height: 100 }], { columns: 2, gap: 0, cellRatio: "original", cellWidth: 100 });
        expect(layout.cells[0]).toEqual({ x: 0, y: 0, width: 100, height: 200 });
        expect(layout.cells[1]).toEqual({ x: 100, y: 0, width: 100, height: 200 });
        expect(layout.cells[2]).toEqual({ x: 0, y: 200, width: 100, height: 100 });
        expect(layout.height).toBe(300);
    });

    test("固定比例 3:4 → 单元格高 = 宽 × 4/3", () => {
        const layout = computeCollageLayout([square], { columns: 2, gap: 0, cellRatio: "3:4", cellWidth: 300 });
        expect(layout.cells[0]).toEqual({ x: 0, y: 0, width: 300, height: 400 });
        // 图片数少于列数时按实际张数计宽
        expect(layout.width).toBe(300);
    });
});

describe("fitImage", () => {
    test("contain 居中", () => {
        const fit = fitImage({ width: 200, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }, "contain");
        expect(fit).toEqual({ sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 25, dw: 100, dh: 50 });
    });

    test("cover 裁切居中", () => {
        const fit = fitImage({ width: 200, height: 100 }, { x: 10, y: 10, width: 100, height: 100 }, "cover");
        expect(fit).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100, dx: 10, dy: 10, dw: 100, dh: 100 });
    });

    test("图片尺寸为 0(如无尺寸 SVG)→ 直接铺满单元格,不产生 NaN", () => {
        const fit = fitImage({ width: 0, height: 0 }, { x: 10, y: 20, width: 100, height: 50 }, "contain");
        expect(fit).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0, dx: 10, dy: 20, dw: 100, dh: 50 });
    });
});

describe("排序", () => {
    test("applyOrder:已存顺序在前,新增的按原顺序追加,失效的忽略", () => {
        const items = [{ key: "a" }, { key: "b" }, { key: "c" }];
        expect(applyOrder(items, ["c", "x", "a"]).map((item) => item.key)).toEqual(["c", "a", "b"]);
    });

    test("moveKey:把 from 移到 to 的位置", () => {
        expect(moveKey(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
        expect(moveKey(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
        expect(moveKey(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    });
});
