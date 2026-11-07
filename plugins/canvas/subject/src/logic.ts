// 主体节点的纯逻辑:主体库增删改、参考图上限、资源输出。只用 SDK 类型,便于直接 bun test。
import type { CanvasNodeMetadata, CanvasNodeResource } from "@infinite-canvas/plugin-sdk";

export type SubjectKind = "character" | "product" | "other";

export type SubjectRecord = {
    id: string;
    name: string;
    kind: SubjectKind;
    description: string;
    images: string[];
};

// 插件存储里主体库的键
export const SUBJECTS_KEY = "subjects";
export const MAX_IMAGES = 4;
export const MAX_IMAGES_ERROR = "最多 4 张参考图";
export const DEFAULT_SUBJECT_NAME = "主体";

export const SUBJECT_KINDS: { value: SubjectKind; label: string }[] = [
    { value: "character", label: "角色" },
    { value: "product", label: "商品" },
    { value: "other", label: "其他" },
];

/** 同 id 原位覆盖,新 id 追加到末尾 */
export function upsertSubject(list: SubjectRecord[], record: SubjectRecord): SubjectRecord[] {
    const index = list.findIndex((item) => item.id === record.id);
    if (index < 0) return [...list, record];
    return list.map((item, i) => (i === index ? record : item));
}

export function removeSubject(list: SubjectRecord[], id: string): SubjectRecord[] {
    return list.filter((item) => item.id !== id);
}

export function renameSubject(list: SubjectRecord[], id: string, name: string): SubjectRecord[] {
    return list.map((item) => (item.id === id ? { ...item, name } : item));
}

/** 追加一张参考图;已满 4 张时原样返回并带错误提示,重复地址直接忽略 */
export function addImage(images: string[], url: string): { images: string[]; error?: string } {
    if (images.includes(url)) return { images };
    if (images.length >= MAX_IMAGES) return { images, error: MAX_IMAGES_ERROR };
    return { images: [...images, url] };
}

/** 从节点 metadata 读出当前主体(字段缺省时给默认值) */
export function readSubject(metadata: CanvasNodeMetadata | undefined): SubjectRecord {
    const kind = metadata?.subjectKind as SubjectKind | undefined;
    return {
        id: (metadata?.subjectId as string | undefined) || "",
        name: (metadata?.subjectName as string | undefined) || "",
        kind: SUBJECT_KINDS.some((item) => item.value === kind) ? (kind as SubjectKind) : "character",
        description: (metadata?.subjectDescription as string | undefined) || "",
        images: Array.isArray(metadata?.subjectImages) ? (metadata.subjectImages as string[]) : [],
    };
}

/** 主体写回节点 metadata 的字段 */
export function subjectToMetadata(record: SubjectRecord): CanvasNodeMetadata {
    return {
        subjectId: record.id,
        subjectName: record.name,
        subjectKind: record.kind,
        subjectDescription: record.description,
        subjectImages: record.images,
    };
}

/** 作为上游资源:输出全部参考图;开启「描述拼进提示词」且描述非空时附带「名称：描述」 */
export function buildSubjectResource(metadata: CanvasNodeMetadata | undefined): CanvasNodeResource | null {
    const subject = readSubject(metadata);
    if (!subject.images.length) return null;
    const description = subject.description.trim();
    if (metadata?.appendDescription && description) {
        return { kind: "image", urls: subject.images, text: `${subject.name.trim() || DEFAULT_SUBJECT_NAME}：${description}` };
    }
    return { kind: "image", urls: subject.images };
}
