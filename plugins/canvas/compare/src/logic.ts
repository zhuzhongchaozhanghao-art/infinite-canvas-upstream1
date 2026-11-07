// 对比节点的纯逻辑:百分比限制、指针位置换算、模式归一、取前两张图。

export type CompareMode = "slider" | "side";

/** 分隔线位置限制在 0–100,非法值回退到默认 50 */
export function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 50;
    return Math.min(100, Math.max(0, value));
}

/** 指针横坐标在容器 [left, left + width] 内的百分比位置 */
export function percentFromPointer(clientX: number, left: number, width: number): number {
    if (!(width > 0)) return 50;
    return clampPercent(((clientX - left) / width) * 100);
}

/** metadata.compareMode 只认 "side",其余一律视为滑块模式 */
export function normalizeMode(value: unknown): CompareMode {
    return value === "side" ? "side" : "slider";
}

/** 取上游前两张图;不足两张返回 null */
export function pickPair(images: string[]): [string, string] | null {
    return images.length >= 2 ? [images[0], images[1]] : null;
}
