import { expect, test } from "bun:test";
import { buildCharacterGroup, CHARACTER_IMAGE_LABELS, filterCharacters, readCharacterDetail, readCharacterIndex, safeCharacterPath } from "../src/plugins/character-library/catalog";

const role = { id: "one", name: "温润儒商", category: "现代都市·现代", preview: "modern/one/cover.jpg", metadata: "modern/one/metadata.json", attributes: { 性别: "男", 年龄段: "中年" }, tags: ["职场"], descriptions: [] };
const detailData = { descriptions: [{ label: "着装描述", text: "米灰色西装" }], localFiles: CHARACTER_IMAGE_LABELS.map((label, index) => ({ label, path: `${index}.jpg` })), files: CHARACTER_IMAGE_LABELS.map((label) => ({ label, url: "https://source.example/original.jpg" })) };

test("local export metadata resolves all four ORIGINAL files, not the cover or external source URLs", () => {
    const parsed = readCharacterIndex({ schemaVersion: 1, roles: [role] });
    const detail = readCharacterDetail(parsed[0], detailData);
    expect(detail.assets).toEqual(CHARACTER_IMAGE_LABELS.map((label, index) => ({ label, path: `modern/one/${index}.jpg` })));
    expect(detail.descriptions[0].text).toBe("米灰色西装");
});

test("portable URL catalogs and character metadata both require four unambiguous references", () => {
    const files = CHARACTER_IMAGE_LABELS.map((label, index) => ({ label, url: `originals/${index}.png` }));
    const parsed = readCharacterIndex({ schemaVersion: 1, roles: [{ ...role, metadata: undefined, files }] });
    expect(readCharacterDetail(parsed[0]).assets.map((asset) => asset.path)).toEqual(files.map((file) => file.url));
    expect(() => readCharacterDetail(role, { files: files.slice(0, 3) })).toThrow("missingImages");
    expect(() => readCharacterDetail(role, { files: [...files, files[0]] })).toThrow("missingImages");
});

test("invalid catalogs, duplicate identities, and paths outside the selected folder are rejected", () => {
    expect(() => readCharacterIndex({ schemaVersion: 2, roles: [role] })).toThrow();
    expect(() => readCharacterIndex({ schemaVersion: 1, roles: [role, role] })).toThrow();
    for (const path of ["../other/image.png", "/image.png", "C:\\images\\file.png", "https://example.com/image.png", "folder//image.png"]) expect(() => safeCharacterPath(path)).toThrow("invalidPath");
    expect(safeCharacterPath("古装历史/角色/三视图.jpg")).toEqual(["古装历史", "角色", "三视图.jpg"]);
});

test("search, parent/era categories, and attribute filters combine without changing the catalog", () => {
    const other = { ...role, id: "two", name: "宋代女侠", category: "古装历史·宋", attributes: { 性别: "女", 年龄段: "青年" } };
    const roles = [role, other];
    expect(filterCharacters(roles, "职场", "现代都市", { 性别: "男" })).toEqual([role]);
    expect(filterCharacters(roles, "女侠", "古装历史·宋", { 性别: "女" })).toEqual([other]);
    expect(filterCharacters(roles, "", "现代都市", { 性别: "女" })).toEqual([]);
    expect(roles).toHaveLength(2);
});

test("a character is one native group and four full-ratio persisted image nodes with no generation request", () => {
    const detail = readCharacterDetail(role, detailData);
    const sizes = [[1024, 1536], [1024, 1536], [1536, 1536], [2048, 1024]];
    const images = sizes.map(([width, height], index) => ({ width, height, url: `blob:image-${index}`, storageKey: `image:${index}`, mimeType: "image/jpeg", bytes: 100 }));
    const ops = buildCharacterGroup(detail, images, [], "group-one", 340);
    const additions = ops.filter((op) => op.type === "add_node");
    expect(additions.filter((op) => op.nodeType === "group")).toHaveLength(1);
    expect(additions.filter((op) => op.nodeType === "image")).toHaveLength(4);
    for (const node of additions.filter((op) => op.nodeType === "image")) {
        const index = Number(node.id!.split(":").at(-1));
        expect(node.metadata?.groupId).toBe("group-one");
        expect(node.metadata?.storageKey).toBe(`image:${index}`);
        expect(node.height! / node.width!).toBeCloseTo(sizes[index][1] / sizes[index][0]);
        const group = additions[0];
        expect(node.position!.x).toBeGreaterThanOrEqual(group.position!.x);
        expect(node.position!.x + node.width!).toBeLessThanOrEqual(group.position!.x + group.width!);
        expect(node.position!.y + node.height!).toBeLessThanOrEqual(group.position!.y + group.height!);
    }
    expect(ops.some((op) => op.type === "run_generation")).toBe(false);
    expect(() => buildCharacterGroup(detail, images.slice(1), [], "group-two", 340)).toThrow("missingImages");
});

test("the bundled preview catalog uses the same metadata and four original files as the local export", async () => {
    const root = new URL("../public/character-library-demo/", import.meta.url);
    const catalog = readCharacterIndex(await Bun.file(new URL("index.json", root)).json());
    const detail = readCharacterDetail(catalog[0], await Bun.file(new URL(catalog[0].metadata!, root)).json());
    expect(detail.assets.map((asset) => asset.label)).toEqual([...CHARACTER_IMAGE_LABELS]);
    for (const asset of detail.assets) expect(await Bun.file(new URL(asset.path, root)).exists()).toBe(true);
});
