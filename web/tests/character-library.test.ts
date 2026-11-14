import { expect, test } from "bun:test";
import { buildCharacterGroup, CHARACTER_IMAGE_LABELS, filterCharacters, readCharacterDetail, readCharacterIndex, safeCharacterPath } from "../src/plugins/character-library/catalog";
import { DEFAULT_ASSET_FEEDS, buildReferenceNodes, filterReferenceAssets, readReferenceAssets, validateAssetFeeds } from "../src/plugins/character-library/asset-catalog";

const costumeFeed = DEFAULT_ASSET_FEEDS.find((feed) => feed.id === "anhao-costume")!;
const costume = {
    id: "SPR-0001",
    分类: "春季穿搭",
    服装名称: "象牙白荷叶边针织衫",
    标签: ["象牙白", "荷叶边", "针织", "牛仔", "迷你", "半身裙", "大衣", "短袜", "白色", "运动鞋"],
    关键词: "ivory frill knit denim mini skirt coat socks white sneakers",
    缩略图: "thumbs/costume/SPR-0001.webp",
    原图: "img/costume/SPR-0001.webp",
    检索: "SPR-0001 春季穿搭",
};

test("online clothing retains every original tag, English term, ID, and attribution", () => {
    const [item] = readReferenceAssets([costume], costumeFeed);
    expect(item.tags).toEqual(costume.标签);
    expect(item.keywords).toBe(costume.关键词);
    expect(item.raw).toEqual([costume]);
    expect(item.sourceName).toBe("ギア · 现实服装");
    expect(filterReferenceAssets([item], "DENIM mini", "春季穿搭", "荷叶边", costumeFeed.id, false)).toEqual([item]);
    expect(filterReferenceAssets([item], "", "春季穿搭", "不存在", "", false)).toEqual([]);
    expect(item.views[0].original).toEndWith("/img/costume/SPR-0001.webp");
});

test("pose groups preserve distinct angles and map mannequin/depth images without doubling references", () => {
    const feed = DEFAULT_ASSET_FEEDS[0];
    const front = { id: "single_P001_front", 体系: "全身单人・标准系", 姿势编号: "P001", 分类: "站姿", 姿势名称: "自然站立", 角度: "正面", 缩略图: "thumbs/single_P001_front.jpg", 原图: "img/single_P001_front.png", 检索: "站立 正面" };
    const side = { ...front, id: "single_P001_side", 角度: "侧面", 缩略图: "thumbs/single_P001_side.jpg", 原图: "img/single_P001_side.png" };
    const [pose] = readReferenceAssets([front, side], feed);
    expect(pose.views.map((v) => v.label)).toEqual(["正面", "侧面"]);
    expect(pose.views[0].depthOriginal).toEndWith("/img/depth/single_P001_front.webp");
    expect(pose.views[0].depthThumbnail).toEndWith("/thumbs/depth/single_P001_front.webp");
    expect(pose.raw).toEqual([front, side]);
    expect(filterReferenceAssets([pose], "侧面", "", "全身单人・标准系", "", false)).toHaveLength(1);
    const sensitive = readReferenceAssets([{ ...front, 体系: "双人缠绵" }], feed);
    expect(filterReferenceAssets(sensitive, "", "", "", "", false)).toHaveLength(0);
    expect(filterReferenceAssets(sensitive, "", "", "", "", true)).toHaveLength(1);
});

test("multiview costumes and portraits preserve their own schemas instead of losing original fields", () => {
    const views = ["正面", "背面"].map((label, index) => ({ id: `${index}`, label, 缩略图: `thumbs/${index}.webp`, 原图: `img/${index}.webp` }));
    const [multi] = readReferenceAssets([{ ...costume, views, 来源: "Shisei · wquguru", 来源地址: "https://github.com/wquguru/shisei", 日文名称: "元の名前" }], costumeFeed);
    expect(multi.views.map((v) => v.label)).toEqual(["正面", "背面"]);
    expect(multi.homepage).toBe("https://github.com/wquguru/shisei");
    expect(filterReferenceAssets([multi], "元の名前", "", "", "", false)).toHaveLength(1);
    const [portrait] = readReferenceAssets([{ id: "p1", 分区: "正脸参考", 发长: "短发", 发型名称: "基础款", 标题: "短发标准款", 缩略图: "thumbs/p1.webp", 原图: "img/p1.webp", 热门: true }], DEFAULT_ASSET_FEEDS.at(-1)!);
    expect(portrait.attributes).toEqual({ 分区: "正脸参考", 发长: "短发", 发型名称: "基础款" });
    expect(portrait.raw[0].热门).toBe(true);
});

test("bad catalogs and source settings are rejected before replacing a working catalog", () => {
    expect(validateAssetFeeds(DEFAULT_ASSET_FEEDS)).toHaveLength(6);
    expect(() => validateAssetFeeds([costumeFeed, costumeFeed])).toThrow("invalidFeed");
    expect(() => validateAssetFeeds([{ ...costumeFeed, url: "javascript:alert(1)" }])).toThrow("invalidFeed");
    expect(() => readReferenceAssets([costume, costume], costumeFeed)).toThrow("invalidFeed");
    expect(() => readReferenceAssets([{ ...costume, 原图: "file:///C:/private.png" }], costumeFeed)).toThrow("invalidFeed");
    expect(() => readReferenceAssets([{ ...costume, views: [{ id: "front" }] }], costumeFeed)).toThrow("invalidFeed");
});

test("selected online references produce one image or a native group with original tags and full ratios", () => {
    const [item] = readReferenceAssets([costume], costumeFeed);
    const image = { width: 1000, height: 1500, url: "blob:original", storageKey: "image:original", mimeType: "image/webp", bytes: 100 };
    const ops = buildReferenceNodes(item, item.views, [image], [], "one", 340, false);
    expect(ops.filter((op) => op.type === "add_node")).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "add_node", nodeType: "image", width: 340, height: 510, metadata: { assetReference: { tags: costume.标签, itemId: "SPR-0001", keywords: costume.关键词 } } });
    const grouped = buildReferenceNodes(item, [item.views[0], { ...item.views[0], id: "back", label: "背面" }], [image, { ...image, width: 1500, height: 1000 }], [], "group", 340, false);
    expect(grouped.filter((op) => op.type === "add_node")).toHaveLength(3);
    expect(grouped[0]).toMatchObject({ nodeType: "group" });
    expect(grouped.some((op) => op.type === "run_generation")).toBe(false);
    expect(() => buildReferenceNodes(item, item.views, [], [], "bad", 340, false)).toThrow("importFailed");
});

const role = { id: "one", name: "温润儒商", category: "现代都市·现代", preview: "modern/one/cover.jpg", metadata: "modern/one/metadata.json", attributes: { 性别: "男", 年龄段: "中年" }, tags: ["职场"], descriptions: [] };
const detailData = {
    descriptions: [{ label: "着装描述", text: "米灰色西装" }],
    localFiles: CHARACTER_IMAGE_LABELS.map((label, index) => ({ label, path: `${index}.jpg` })),
    files: CHARACTER_IMAGE_LABELS.map((label) => ({ label, url: "https://source.example/original.jpg" })),
};

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
    const sizes = [
        [1024, 1536],
        [1024, 1536],
        [1536, 1536],
        [2048, 1024],
    ];
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
