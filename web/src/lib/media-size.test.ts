import assert from "node:assert/strict";
import { test } from "node:test";
import { getImageSizingProfile, IMAGE_MAX_PIXELS, parsePixelSize, resolveImageSizing } from "./media-size";

test("follow the first reference without changing the selected resolution", () => {
    const sizing = { aspectRatio: "auto", resolution: "2k" };
    assert.deepEqual(resolveImageSizing(sizing, "1024:1024"), { ratio: "1:1", size: "2048x2048" });
    assert.deepEqual(resolveImageSizing(sizing, "1920:1080"), { ratio: "16:9", size: "2048x1152" });
    assert.deepEqual(resolveImageSizing(sizing, "1376:768"), { ratio: "1376:768", size: "2048x1136" });
    assert.deepEqual(resolveImageSizing(sizing), { ratio: "1:1", size: "2048x2048" });
});

test("custom ratios use the output tier, independent of reference pixel count", () => {
    const sizing = { aspectRatio: "auto", resolution: "1k" };
    assert.deepEqual(resolveImageSizing(sizing, "1333:3432"), { ratio: "1333:3432", size: "784x2016" });
    assert.equal(resolveImageSizing(sizing, "2666:6864").size, "784x2016");
    assert.equal(resolveImageSizing(sizing, "3432:1333").size, "2016x784");
    assert.equal(resolveImageSizing(sizing, "790:1631").size, "976x2016");
    assert.equal(resolveImageSizing({ ...sizing, resolution: "2k" }, "1333:3432").size, "1040x2688");
    assert.equal(resolveImageSizing(sizing, "500:2000").unsupportedRatio, true);
    const output = parsePixelSize(resolveImageSizing({ ...sizing, resolution: "4k" }, "161:100").size)!;
    assert.ok(output.width * output.height <= IMAGE_MAX_PIXELS);
    assert.equal(output.width % 16 + output.height % 16, 0);
    assert.ok(Math.abs(output.width / output.height - 1.61) < 0.01);
});

test("an explicit ratio overrides the reference; both automatic settings delegate sizing", () => {
    assert.equal(resolveImageSizing({ aspectRatio: "9:16", resolution: "2k" }, "1024:1024").size, "1152x2048");
    assert.equal(resolveImageSizing({ aspectRatio: "16:9", resolution: "auto" }, "1024:1024").size, "16:9");
    assert.equal(resolveImageSizing({ aspectRatio: "auto", resolution: "auto" }, "1024:1024").size, "auto");
});

test("fixed-size image models snap to a supported ratio and use their own tier dimensions", () => {
    const profile = getImageSizingProfile("channel::nano-banana2-1k", "openai");
    const sizing = { aspectRatio: "auto", resolution: "1k" };
    assert.deepEqual(resolveImageSizing(sizing, "2160:3840", profile), { ratio: "9:16", size: "768x1376" });
    assert.deepEqual(resolveImageSizing(sizing, "1333:3432", profile), { ratio: "9:16", size: "768x1376" });
    assert.equal(resolveImageSizing({ ...sizing, aspectRatio: "9:21" }, undefined, profile).unsupportedRatio, true);
    assert.equal(resolveImageSizing({ ...sizing, resolution: "2k" }, undefined, profile).unsupportedResolution, "1k");
    const gemini = getImageSizingProfile("gemini-3.1-flash-image", "gemini");
    assert.equal(resolveImageSizing({ ...sizing, resolution: "4k" }, "2160:3840", gemini).size, "3072x5504");
    assert.equal(getImageSizingProfile("gpt-image-2", "openai"), undefined);
});

test("Nano Banana Pro SKUs use the same fixed-size rules", () => {
    const profile = getImageSizingProfile("channel::nano-banana-pro-1k", "openai");
    const sizing = { aspectRatio: "auto", resolution: "1k" };
    assert.deepEqual(resolveImageSizing(sizing, "706:1167", profile), { ratio: "9:16", size: "768x1376" });
    assert.equal(resolveImageSizing({ ...sizing, resolution: "2k" }, "706:1167", profile).unsupportedResolution, "1k");
    const native = getImageSizingProfile("models/gemini-3-pro-image-preview", "gemini");
    assert.equal(resolveImageSizing({ ...sizing, resolution: "2k" }, "706:1167", native).size, "1536x2752");
});
