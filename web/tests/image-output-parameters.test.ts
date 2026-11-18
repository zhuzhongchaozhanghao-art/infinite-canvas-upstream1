import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

test("Nano Banana 2.1 sends the chosen aspect ratio and tier in both OpenAI image endpoints", async () => {
    const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const post = axios.post;
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    try {
        const { requestEdit, requestGeneration } = await import("../src/services/api/image");
        const { resolveImageSizing, getImageSizingProfile } = await import("../src/lib/media-size");
        const { defaultConfig } = await import("../src/stores/use-config-store");
        const model = "nano-banana2.1";
        const config = {
            ...defaultConfig,
            model: `test::${model}`,
            quality: "auto",
            count: "1",
            channels: [{
                id: "test", name: "Test", apiFormat: "openai" as const,
                baseUrl: "https://image.test/v1", apiKey: "test-key",
                models: [{ name: model, capability: "image" as const }, { name: "gemini-nano-banana-2.1", capability: "image" as const }, { name: "gpt-image-2", capability: "image" as const }],
            }],
        };
        const requests: Array<{ size: unknown; quality: unknown }> = [];
        axios.post = (async (_url: string, body: FormData | { size?: string; quality?: string }) => {
            requests.push(body instanceof FormData ? { size: body.get("size"), quality: body.get("quality") } : { size: body.size, quality: body.quality });
            return { data: { data: [{ b64_json: "AA==" }] } };
        }) as typeof axios.post;

        const sizing = { aspectRatio: "2:3", resolution: "1k" };
        const size = resolveImageSizing(sizing, undefined, getImageSizingProfile(config.model, "openai")).size;
        const reference = { id: "test", name: "test.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" };
        await requestEdit({ ...config, size }, "test", [reference], { sizing });
        await requestGeneration({ ...config, model: "test::gemini-nano-banana-2.1", size: "1360x2048", quality: "high" }, "test");
        await requestGeneration({ ...config, model: "test::gpt-image-2", size: "1024x1536", quality: "high" }, "test", { sizing });
        assert.deepEqual(requests, [
            { size: "2:3", quality: "1k" },
            { size: "2:3", quality: "2k" },
            { size: "1024x1536", quality: "high" },
        ]);
    } finally {
        axios.post = post;
        if (storage) Object.defineProperty(globalThis, "localStorage", storage);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
});
