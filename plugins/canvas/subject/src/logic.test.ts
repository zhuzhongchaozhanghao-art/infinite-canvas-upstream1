import { describe, expect, test } from "bun:test";
import { addImage, buildSubjectResource, MAX_IMAGES_ERROR, removeSubject, renameSubject, upsertSubject } from "./logic";
import type { SubjectRecord } from "./logic";

const record = (id: string, name = "主体"): SubjectRecord => ({ id, name, kind: "character", description: "", images: [] });

describe("upsertSubject", () => {
    test("新 id 追加", () => {
        const list = upsertSubject([record("a")], record("b"));
        expect(list.map((item) => item.id)).toEqual(["a", "b"]);
    });

    test("同 id 覆盖且位置不变", () => {
        const list = upsertSubject([record("a", "旧"), record("b")], record("a", "新"));
        expect(list).toHaveLength(2);
        expect(list[0]).toEqual(record("a", "新"));
    });
});

describe("removeSubject / renameSubject", () => {
    test("删除对应项", () => {
        expect(removeSubject([record("a"), record("b")], "a").map((item) => item.id)).toEqual(["b"]);
    });

    test("重命名对应项", () => {
        expect(renameSubject([record("a"), record("b")], "b", "小白")[1].name).toBe("小白");
    });
});

describe("addImage", () => {
    test("4 张以内正常追加", () => {
        expect(addImage(["1", "2"], "3")).toEqual({ images: ["1", "2", "3"] });
    });

    test("第 5 张返回错误「最多 4 张参考图」", () => {
        const result = addImage(["1", "2", "3", "4"], "5");
        expect(result.error).toBe("最多 4 张参考图");
        expect(MAX_IMAGES_ERROR).toBe("最多 4 张参考图");
        expect(result.images).toEqual(["1", "2", "3", "4"]);
    });
});

describe("buildSubjectResource", () => {
    test("无图时返回 null", () => {
        expect(buildSubjectResource({ subjectImages: [] })).toBeNull();
    });

    test("默认只输出多图", () => {
        expect(buildSubjectResource({ subjectImages: ["a", "b"], subjectName: "小白", subjectDescription: "短发" })).toEqual({ kind: "image", urls: ["a", "b"] });
    });

    test("开启描述拼接且描述非空时带 text", () => {
        expect(buildSubjectResource({ subjectImages: ["a"], subjectName: "小白", subjectDescription: "短发", appendDescription: true })).toEqual({ kind: "image", urls: ["a"], text: "小白：短发" });
    });

    test("开启但描述为空时不带 text", () => {
        expect(buildSubjectResource({ subjectImages: ["a"], subjectDescription: "  ", appendDescription: true })).toEqual({ kind: "image", urls: ["a"] });
    });
});
