// 浏览器端切图:把宫格大图按矩形逐块绘制到 canvas 并导出 data URL。
import type { TileRect } from "./logic";

export type SlicedTile = { dataUrl: string; width: number; height: number };

export async function sliceImage(src: string, rects: TileRect[]): Promise<SlicedTile[]> {
    const image = await loadImage(src);
    // 大图是 JPEG 时切图也用 JPEG,避免 PNG 体积暴涨
    const mime = src.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
    return rects.map((rect) => {
        const canvas = document.createElement("canvas");
        canvas.width = rect.width;
        canvas.height = rect.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器不支持 canvas,无法切图");
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        return { dataUrl: canvas.toDataURL(mime, 0.92), width: rect.width, height: rect.height };
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("宫格大图读取失败"));
        image.src = src;
    });
}
