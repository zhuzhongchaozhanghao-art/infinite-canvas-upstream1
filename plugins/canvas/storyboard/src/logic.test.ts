import { describe, expect, test } from "bun:test";
import { buildShotPrompt, parseStoryboard, renumberRows, runPool } from "./logic";

describe("parseStoryboard", () => {
    test("纯 JSON 数组解析为行，镜号从 1 开始", () => {
        const rows = parseStoryboard(JSON.stringify([
            { shot: 7, seconds: 3, framing: "远景", description: "城市清晨", subject: "城市" },
            { shot: 9, seconds: 4, framing: "近景", description: "女孩推门", subject: "女孩" },
        ]));
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.shot)).toEqual([1, 2]);
        expect(rows[1]).toMatchObject({ seconds: 4, framing: "近景", description: "女孩推门", subject: "女孩" });
        expect(rows[0].id).not.toBe(rows[1].id);
    });

    test("容忍 ```json 代码块包裹与前后说明文字", () => {
        const text = "好的，下面是分镜：\n```json\n[{\"shot\":1,\"seconds\":2,\"framing\":\"特写\",\"description\":\"眼睛\",\"subject\":\"女孩\"}]\n```\n希望有帮助。";
        const rows = parseStoryboard(text);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ shot: 1, seconds: 2, framing: "特写", description: "眼睛" });
    });

    test("非 JSON 抛错", () => {
        expect(() => parseStoryboard("这不是 JSON")).toThrow();
        expect(() => parseStoryboard("{\"shot\":1}")).toThrow();
    });

    test("seconds 缺失或非数字时默认 5", () => {
        const rows = parseStoryboard(JSON.stringify([{ description: "a" }, { seconds: "abc", description: "b" }, { seconds: "6", description: "c" }]));
        expect(rows.map((row) => row.seconds)).toEqual([5, 5, 6]);
    });
});

describe("buildShotPrompt", () => {
    test("包含景别与画面描述", () => {
        const prompt = buildShotPrompt({ id: "r1", shot: 1, seconds: 5, framing: "中景", description: "男人在雨中奔跑", subject: "男人" });
        expect(prompt).toContain("中景");
        expect(prompt).toContain("男人在雨中奔跑");
    });
});

describe("renumberRows", () => {
    test("镜号按行序重排", () => {
        const rows = renumberRows([
            { id: "a", shot: 3, seconds: 5, framing: "", description: "", subject: "" },
            { id: "b", shot: 1, seconds: 5, framing: "", description: "", subject: "" },
        ]);
        expect(rows.map((row) => [row.id, row.shot])).toEqual([["a", 1], ["b", 2]]);
    });
});

describe("runPool", () => {
    test("并发不超过上限且全部执行", async () => {
        let running = 0;
        let peak = 0;
        const done: number[] = [];
        await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            running -= 1;
            done.push(item);
        });
        expect(peak).toBe(3);
        expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
});
