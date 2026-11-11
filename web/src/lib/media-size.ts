export const mediaScaleOptions = ["1k", "2k", "4k", "auto"] as const;
export type ImageSizing = { aspectRatio: string; resolution: string };
export const IMAGE_SIZE_STEP = 16;
export const IMAGE_MAX_PIXELS = 8294400;
export const IMAGE_MAX_RATIO = 3;

export const mediaRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "2:3", width: 2, height: 3 },
    { value: "3:2", width: 3, height: 2 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:4", width: 3, height: 4 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "9:21", width: 9, height: 21 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const imageSizePresets: Record<string, Record<string, string>> = {
    "1k": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1536x864", "9:16": "864x1536", "21:9": "2016x864", "9:21": "864x2016" },
    "2k": { "1:1": "2048x2048", "2:3": "1360x2048", "3:2": "2048x1360", "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152", "9:16": "1152x2048", "21:9": "2688x1152", "9:21": "1152x2688" },
    "4k": { "1:1": "2880x2880", "2:3": "2336x3520", "3:2": "3520x2336", "4:3": "3312x2480", "3:4": "2480x3312", "16:9": "3840x2160", "9:16": "2160x3840", "21:9": "3840x1648", "9:21": "1648x3840" },
};

// Shared Nano Banana 2 and Pro output sizes, restricted to the canvas ratio options.
const bananaSizes: typeof imageSizePresets = {
    "1k": { "1:1": "1024x1024", "2:3": "848x1264", "3:2": "1264x848", "4:3": "1200x896", "3:4": "896x1200", "16:9": "1376x768", "9:16": "768x1376", "21:9": "1584x672" },
    "2k": { "1:1": "2048x2048", "2:3": "1696x2528", "3:2": "2528x1696", "4:3": "2400x1792", "3:4": "1792x2400", "16:9": "2752x1536", "9:16": "1536x2752", "21:9": "3168x1344" },
    "4k": { "1:1": "4096x4096", "2:3": "3392x5056", "3:2": "5056x3392", "4:3": "4800x3584", "3:4": "3584x4800", "16:9": "5504x3072", "9:16": "3072x5504", "21:9": "6336x2688" },
};

type ImageSizingProfile = { ratios: string[]; sizes?: typeof imageSizePresets; fixedResolution?: string };
const geminiCanvasRatios = Object.keys(bananaSizes["1k"]);

export function getImageSizingProfile(model: string, apiFormat: string): ImageSizingProfile | undefined {
    const name = model.toLowerCase().split("::").at(-1)?.replace(/^models\//, "") || "";
    const banana = /^nano-banana(?:-?2|-pro)(?:-(1k|2k|4k))?$/.exec(name);
    if (banana || /^gemini-(?:3\.1-flash|3-pro)-image(?:-preview)?$/.test(name)) {
        return { ratios: geminiCanvasRatios, sizes: bananaSizes, fixedResolution: banana?.[1] };
    }
    if (apiFormat === "gemini") return { ratios: geminiCanvasRatios };
}

export function parsePixelSize(value: string) {
    const match = String(value || "").match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseAspectRatio(value: string) {
    const match = String(value || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return null;
    return { width, height };
}

export const videoRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "3:4", width: 3, height: 4 },
    { value: "4:3", width: 4, height: 3 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 30;

export function normalizeMediaScale(value: string | undefined) {
    const scale = String(value || "").trim().toLowerCase();
    if (scale === "2k" || scale === "2048") return "2k";
    if (scale === "4k" || scale === "3840") return "4k";
    if (scale === "auto") return "auto";
    if (mediaScaleOptions.includes(scale as (typeof mediaScaleOptions)[number])) return scale;
    return "1k";
}

export function inferMediaScale(size: string, storedScale?: string) {
    if (storedScale) return normalizeMediaScale(storedScale);
    if (!size || size === "auto") return "auto";
    if (parseAspectRatio(size)) return "auto";
    const pixels = parsePixelSize(size);
    if (!pixels) return "auto";
    const presetScale = Object.keys(imageSizePresets).find((scale) => Object.values(imageSizePresets[scale]).includes(`${pixels.width}x${pixels.height}`));
    if (presetScale) return presetScale;
    const longSide = Math.max(pixels.width, pixels.height);
    if (longSide >= 3072) return "4k";
    if (longSide >= 1536) return "2k";
    return "1k";
}

export function inferMediaRatio(size: string, fallback = "1:1") {
    if (!size || size === "auto") return "auto";
    if (mediaRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return fallback;
    const target = pixels.width / pixels.height;
    return mediaRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = mediaRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 1) / Math.max(1, bestOption?.height || 1);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, fallback);
}

export function computeMediaSize(scale: string, ratio: string) {
    if (ratio === "auto" || !ratio) return "auto";
    const normalizedScale = normalizeMediaScale(scale);
    if (normalizedScale === "auto") return ratio;
    return imageSizePresets[normalizedScale][ratio];
}

export function resolveImageSizing({ aspectRatio, resolution }: ImageSizing, referenceRatio?: string, profile?: ImageSizingProfile) {
    if (profile) {
        const tier = profile.fixedResolution;
        if (tier && resolution !== "auto" && resolution !== tier) return { ratio: aspectRatio, size: "", unsupportedResolution: tier };
        if (aspectRatio === "auto" && resolution === "auto") return { ratio: "auto", size: "auto" };
        const reference = parseAspectRatio(referenceRatio || "");
        const distance = (candidate: string) => {
            const parsed = parseAspectRatio(candidate)!;
            return reference ? Math.abs(Math.log((parsed.width * reference.height) / (parsed.height * reference.width))) : 0;
        };
        const ratio = aspectRatio === "auto" ? profile.ratios.reduce((best, next) => distance(next) < distance(best) ? next : best, "1:1") : aspectRatio;
        if (!profile.ratios.includes(ratio)) return { ratio, size: "", unsupportedRatio: true };
        const scale = tier ?? resolution;
        return { ratio, size: profile.sizes?.[scale === "auto" ? "1k" : scale]?.[ratio] ?? computeMediaSize(scale, ratio) };
    }
    if (aspectRatio !== "auto" || resolution === "auto") return { ratio: aspectRatio, size: computeMediaSize(resolution, aspectRatio) };
    const reference = parseAspectRatio(referenceRatio || "");
    if (!reference) return { ratio: "1:1", size: computeMediaSize(resolution, "1:1") };

    const { width, height } = reference;
    const landscape = width >= height;
    const stretch = Math.max(width, height) / Math.min(width, height);
    const presetRatio = inferMediaRatio(`${Math.max(width, height)}:${Math.min(width, height)}`);
    const preset = parsePixelSize(computeMediaSize(resolution, presetRatio))!;
    const ratio = landscape ? presetRatio : presetRatio.split(":").reverse().join(":");
    const exact = parseAspectRatio(ratio)!;
    if (width * exact.height === height * exact.width) return { ratio, size: computeMediaSize(resolution, ratio) };
    if (stretch > IMAGE_MAX_RATIO) return { ratio: referenceRatio!, size: "", unsupportedRatio: true };

    // Use the selected tier's long edge, then align the other edge without snapping the ratio to a preset.
    const alignDown = (pixels: number) => Math.floor(pixels / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    const alignUp = (pixels: number) => Math.ceil(pixels / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    let long = Math.min(Math.max(preset.width, preset.height), alignDown(Math.sqrt(IMAGE_MAX_PIXELS * stretch)));
    let short: number;
    do {
        short = Math.max(alignUp(long / IMAGE_MAX_RATIO), Math.round(long / stretch / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP);
        if (long * short <= IMAGE_MAX_PIXELS) break;
        long -= IMAGE_SIZE_STEP;
    } while (long > 0);
    return { ratio: referenceRatio!, size: landscape ? `${long}x${short}` : `${short}x${long}` };
}

export function readMediaDimensions(size: string, scale: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeMediaSize(scale === "auto" ? "1k" : scale, ratio === "auto" ? "1:1" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

export function clampVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, seconds)));
}

export function parseVideoResolution(value: string | undefined) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "low") return "480";
    if (raw === "auto" || raw === "high" || raw === "medium") return "720";
    const number = raw.replace(/p$/i, "");
    return /^\d+$/.test(number) && Number(number) > 0 ? number : "720";
}

export function inferVideoRatio(size: string) {
    if (!size || size === "auto") return "auto";
    if (videoRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return "16:9";
    const target = pixels.width / pixels.height;
    return videoRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = videoRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 16) / (bestOption?.height || 9);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, "16:9");
}

export function computeVideoSize(resolution: string, ratio: string) {
    if (ratio === "auto" || !ratio) return "auto";
    const parsed = parseAspectRatio(ratio);
    if (!parsed) return "auto";
    const p = Math.max(1, Math.floor(Number(parseVideoResolution(resolution)) || 720));
    const landscape = parsed.width >= parsed.height;
    const width = evenRound(landscape ? (p * parsed.width) / parsed.height : p);
    const height = evenRound(landscape ? p : (p * parsed.height) / parsed.width);
    return `${width}x${height}`;
}

export function readVideoDimensions(size: string, resolution: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeVideoSize(resolution, ratio === "auto" ? "16:9" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

function evenRound(value: number) {
    return Math.max(2, Math.round(value / 2) * 2);
}
