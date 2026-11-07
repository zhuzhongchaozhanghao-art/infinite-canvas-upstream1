import { describe, expect, test } from "bun:test";
import { buildAssistantRequest, canGenerate } from "./logic";

describe("buildAssistantRequest", () => {
    test("服装描述模式要求按款式/面料/颜色/细节输出", () => {
        const { system, prompt } = buildAssistantRequest("garment", "白衬衫", "");
        for (const word of ["款式", "面料", "颜色", "细节"]) expect(system).toContain(word);
        expect(prompt).toContain("白衬衫");
    });

    test("自定义模式使用自填系统提示词", () => {
        const { system, prompt } = buildAssistantRequest("custom", "a", "b", "S");
        expect(system).toBe("S");
        expect(prompt).toContain("a");
        expect(prompt).toContain("b");
    });

    test("上游与说明均为空时 prompt 为空字符串", () => {
        expect(buildAssistantRequest("expand", "", "").prompt).toBe("");
        expect(buildAssistantRequest("translate-en", "  ", "\n").prompt).toBe("");
    });
});

describe("canGenerate", () => {
    test("无上游文本、无图片、无补充说明时不可生成", () => {
        expect(canGenerate("", 0, " ")).toBe(false);
        expect(canGenerate("", 1, "")).toBe(true);
        expect(canGenerate("a", 0, "")).toBe(true);
        expect(canGenerate("", 0, "b")).toBe(true);
    });
});
