// 拼图合成的纯逻辑:网格布局、单元格内图片适配、排序。不依赖浏览器与宿主,便于单测。

export type CellRatio = "original" | "1:1" | "3:4" | "4:3" | "9:16";
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type CollageLayoutOptions = { columns: number; gap: number; cellRatio: CellRatio; cellWidth: number };
export type CollageLayout = { width: number; height: number; cells: Rect[] };
export type FitMode = "contain" | "cover";
export type FitResult = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number };

// 固定比例:宽:高
const RATIOS: Record<Exclude<CellRatio, "original">, [number, number]> = {
    "1:1": [1, 1],
    "3:4": [3, 4],
    "4:3": [4, 3],
    "9:16": [9, 16],
};

/** 按行优先排网格;「按原图」时行高取该行最高图按 cellWidth 缩放后的高度,固定比例时单元格高 = cellWidth × 高/宽 */
export function computeCollageLayout(sizes: Size[], opts: CollageLayoutOptions): CollageLayout {
    if (sizes.length === 0) return { width: 0, height: 0, cells: [] };
    // 图片数少于列数时按实际张数计列,避免右侧留空
    const columns = Math.max(1, Math.min(Math.floor(opts.columns), sizes.length));
    const { gap, cellWidth } = opts;
    const heightOf = (size: Size) => {
        if (opts.cellRatio !== "original") {
            const [w, h] = RATIOS[opts.cellRatio];
            return Math.round((cellWidth * h) / w);
        }
        return size.width > 0 && size.height > 0 ? Math.round((cellWidth * size.height) / size.width) : cellWidth;
    };
    const cells: Rect[] = [];
    let y = 0;
    for (let start = 0; start < sizes.length; start += columns) {
        const row = sizes.slice(start, start + columns);
        const rowHeight = Math.max(...row.map(heightOf));
        row.forEach((_, col) => cells.push({ x: col * (cellWidth + gap), y, width: cellWidth, height: rowHeight }));
        y += rowHeight + gap;
    }
    return { width: columns * cellWidth + (columns - 1) * gap, height: y - gap, cells };
}

/** 计算图片在单元格内的绘制参数(对应 canvas drawImage 的 9 参数):contain 居中留白,cover 居中裁切 */
export function fitImage(image: Size, cell: Rect, mode: FitMode): FitResult {
    // 无原始尺寸(如未声明宽高的 SVG)时无法按比例适配,直接铺满单元格;sw/sh 为 0 表示不裁切
    if (!(image.width > 0 && image.height > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0, dx: cell.x, dy: cell.y, dw: cell.width, dh: cell.height };
    const scale = mode === "contain" ? Math.min(cell.width / image.width, cell.height / image.height) : Math.max(cell.width / image.width, cell.height / image.height);
    if (mode === "contain") {
        const dw = image.width * scale;
        const dh = image.height * scale;
        return { sx: 0, sy: 0, sw: image.width, sh: image.height, dx: cell.x + (cell.width - dw) / 2, dy: cell.y + (cell.height - dh) / 2, dw, dh };
    }
    const sw = cell.width / scale;
    const sh = cell.height / scale;
    return { sx: (image.width - sw) / 2, sy: (image.height - sh) / 2, sw, sh, dx: cell.x, dy: cell.y, dw: cell.width, dh: cell.height };
}

/** 按已存顺序排列:order 中存在的在前,其余保持原顺序追加,order 里已失效的 key 忽略 */
export function applyOrder<T extends { key: string }>(items: T[], order: string[]): T[] {
    const rank = new Map(order.map((key, index) => [key, index]));
    const ordered = items.filter((item) => rank.has(item.key)).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
    return [...ordered, ...items.filter((item) => !rank.has(item.key))];
}

/** 拖动排序:把 from 移到 to 当前所在位置 */
export function moveKey(keys: string[], from: string, to: string): string[] {
    const fromIndex = keys.indexOf(from);
    const toIndex = keys.indexOf(to);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return keys;
    const next = keys.filter((key) => key !== from);
    next.splice(toIndex, 0, from);
    return next;
}
