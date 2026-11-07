import { useState } from "react";
import { App, Button, Popconfirm, Tooltip } from "antd";
import { Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PERSONAL_SOURCE_ID } from "@/lib/personal-prompts";
import { deletePersonalPrompt, readPersonalPrompts, togglePromptPin } from "@/services/personal-prompts";
import type { Prompt } from "@/services/api/prompts";
import { openPersonalPromptEditor } from "./personal-prompt-editor";

export function PersonalPromptActions({ item, management = false }: { item: Prompt; management?: boolean }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const run = async (action: "pin" | "edit" | "delete") => {
        setBusy(true);
        try {
            if (action === "pin") await togglePromptPin(item.sourceId, item.id);
            else {
                const original = (await readPersonalPrompts()).items.find((record) => record.id === item.id);
                if (!original || original.updatedAt !== item.updatedAt) throw new Error("personalPrompts.editConflict");
                if (action === "edit") openPersonalPromptEditor(original);
                else {
                    await deletePersonalPrompt(original);
                    message.success(t("personalPrompts.deleted"));
                }
            }
        } catch (error) {
            message.error(error instanceof Error && error.message.startsWith("personalPrompts.") ? t(error.message) : t("personalPrompts.failed"));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Tooltip title={t(item.pinnedAt ? "personalPrompts.unpin" : "personalPrompts.pin")}>
                <Button
                    type="text"
                    size="small"
                    aria-label={t(item.pinnedAt ? "personalPrompts.unpin" : "personalPrompts.pin")}
                    aria-pressed={Boolean(item.pinnedAt)}
                    disabled={busy}
                    icon={item.pinnedAt ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    onClick={() => void run("pin")}
                />
            </Tooltip>
            {management && item.sourceId === PERSONAL_SOURCE_ID ? (
                <>
                    <Button type="text" size="small" aria-label={t("personalPrompts.edit")} disabled={busy} icon={<Pencil className="size-3.5" />} onClick={() => void run("edit")} />
                    <Popconfirm title={t("personalPrompts.deleteTitle")} okText={t("personalPrompts.delete")} cancelText={t("personalPrompts.cancel")} onConfirm={() => run("delete")}>
                        <Button type="text" danger size="small" aria-label={t("personalPrompts.delete")} disabled={busy} icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </>
            ) : null}
        </div>
    );
}
