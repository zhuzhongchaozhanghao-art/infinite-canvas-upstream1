import { useEffect, useRef, useState } from "react";
import { App, Button, Input, Modal } from "antd";
import { ImagePlus, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { nanoid } from "nanoid";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { readFileAsDataUrl } from "@/lib/image-utils";
import type { PersonalPrompt } from "@/lib/personal-prompts";
import { savePersonalPrompt } from "@/services/personal-prompts";

// Keep the editor outside result lists: a refresh, pin, or deletion in another
// tab must never unmount an in-progress draft.
const useEditorSession = create<{ session: { id: string; original?: PersonalPrompt } | null }>(() => ({ session: null }));
export function openPersonalPromptEditor(original?: PersonalPrompt) {
    useEditorSession.setState({ session: { id: nanoid(), original } });
}
export function PersonalPromptEditorHost() {
    const session = useEditorSession((state) => state.session);
    return session ? <PersonalPromptEditor key={session.id} original={session.original} onClose={() => useEditorSession.setState({ session: null })} /> : null;
}

export function PersonalPromptEditor({ original, onClose }: { original?: PersonalPrompt; onClose: () => void }) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const [title, setTitle] = useState(original?.title || "");
    const [prompt, setPrompt] = useState(original?.prompt || "");
    const [tags, setTags] = useState(original?.tags.join(", ") || "");
    const [coverUrl, setCoverUrl] = useState(original?.coverUrl || "");
    const [busy, setBusy] = useState(false);
    const [reading, setReading] = useState(false);
    const [error, setError] = useState("");
    const fileRef = useRef<HTMLInputElement>(null);
    const coverRequest = useRef(0);
    const saving = useRef(false);
    const dirty = title !== (original?.title || "") || prompt !== (original?.prompt || "") || tags !== (original?.tags.join(", ") || "") || coverUrl !== (original?.coverUrl || "");
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (dirty) event.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => {
            window.removeEventListener("beforeunload", warn);
        };
    }, [dirty]);
    const close = () => {
        if (busy || reading) return;
        if (!dirty) return onClose();
        modal.confirm({ title: t("personalPrompts.discard"), okText: t("personalPrompts.discardAction"), cancelText: t("personalPrompts.keepEditing"), onOk: onClose });
    };
    const upload = async (file?: File) => {
        if (!file) return;
        const request = ++coverRequest.current;
        setReading(true);
        setError("");
        try {
            if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("personalPrompts.coverFailed");
            const thumbnail = await createImageThumbnail(file);
            const encoded = await readFileAsDataUrl(new File([thumbnail || file], file.name, { type: (thumbnail || file).type }));
            if (request === coverRequest.current) setCoverUrl(encoded);
        } catch {
            if (request === coverRequest.current) setError(t("personalPrompts.coverFailed"));
        } finally {
            if (request === coverRequest.current) setReading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };
    const save = async () => {
        if (saving.current || reading) return;
        if (!title.trim() || !prompt.trim()) return setError(t("personalPrompts.required"));
        saving.current = true;
        setBusy(true);
        setError("");
        try {
            await savePersonalPrompt(
                {
                    title: title.trim(),
                    prompt: prompt.trim(),
                    coverUrl,
                    tags: [
                        ...new Set(
                            tags
                                .split(/[,，]/)
                                .map((tag) => tag.trim())
                                .filter(Boolean),
                        ),
                    ],
                },
                original,
            );
            message.success(t("personalPrompts.saved"));
            onClose();
        } catch (error) {
            setError(error instanceof Error && error.message.startsWith("personalPrompts.") ? t(error.message) : t("personalPrompts.failed"));
        } finally {
            saving.current = false;
            setBusy(false);
        }
    };
    return (
        <Modal open title={t(original ? "personalPrompts.edit" : "personalPrompts.add")} onCancel={close} footer={null} width={600} maskClosable={false}>
            <form
                className="space-y-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                <label className="block space-y-1">
                    <span>{t("personalPrompts.name")}</span>
                    <Input autoFocus value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="block space-y-1">
                    <span>{t("personalPrompts.content")}</span>
                    <Input.TextArea rows={7} value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)} />
                </label>
                <label className="block space-y-1">
                    <span>{t("personalPrompts.tags")}</span>
                    <Input value={tags} disabled={busy} placeholder={t("personalPrompts.tagsHint")} onChange={(event) => setTags(event.target.value)} />
                </label>
                <div className="space-y-2">
                    <div>{t("personalPrompts.cover")}</div>
                    <div className="flex items-center gap-3">
                        {coverUrl ? <img src={coverUrl} alt={title} className="size-24 rounded-lg object-cover" /> : null}
                        <Button icon={<ImagePlus className="size-4" />} loading={reading} disabled={busy} onClick={() => fileRef.current?.click()}>
                            {t("personalPrompts.uploadCover")}
                        </Button>
                        {coverUrl ? (
                            <Button icon={<X className="size-4" />} disabled={busy || reading} onClick={() => setCoverUrl("")}>
                                {t("personalPrompts.removeCover")}
                            </Button>
                        ) : null}
                    </div>
                    <input ref={fileRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files?.[0])} />
                </div>
                {error ? (
                    <div role="alert" className="text-red-500">
                        {error}
                    </div>
                ) : null}
                <p className="text-xs opacity-60">{t("personalPrompts.localNote")}</p>
                <div className="flex justify-end gap-2">
                    <Button disabled={busy || reading} onClick={close}>
                        {t("personalPrompts.cancel")}
                    </Button>
                    <Button type="primary" htmlType="submit" loading={busy} disabled={reading}>
                        {t("personalPrompts.save")}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

export function AddPersonalPromptButton({ compact = false }: { compact?: boolean }) {
    const { t } = useTranslation();
    if (compact) return (
        <button
            type="button"
            aria-label={t("personalPrompts.add")}
            onClick={() => openPersonalPromptEditor()}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
        >
            <Plus className="size-3.5" />
            {t("canvas.sidePanel.add")}
        </button>
    );
    return (
        <Button icon={<Plus className="size-4" />} onClick={() => openPersonalPromptEditor()}>
            {t("personalPrompts.add")}
        </Button>
    );
}
