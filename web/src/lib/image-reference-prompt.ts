import type { ReferenceImage } from "@/types/image";

import i18n from "@/i18n";

export function imageReferenceLabel(index: number) {
    return i18n.t("imageReferences.label", { index: index + 1 });
}

// 逐张标签：放在每张参考图前面，供支持图文交替的接口（Gemini、多模态对话）使用
export function imageReferenceInlineLabel(index: number) {
    return i18n.t("imageReferences.inlineLabel", { label: imageReferenceLabel(index) });
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    return i18n.t("imageReferences.promptPrefix", { labels: labels.join(i18n.t("imageReferences.separator")), prompt: text });
}
