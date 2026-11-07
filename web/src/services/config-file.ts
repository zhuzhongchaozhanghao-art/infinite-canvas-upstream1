import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import { importPersonalPrompts, readPersonalPrompts } from "@/services/personal-prompts";
import { validatePersonalLibrary, type PersonalPromptLibrary } from "@/lib/personal-prompts";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    personalPrompts?: PersonalPromptLibrary;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export async function exportAppConfig() {
    const personalPrompts = await readPersonalPrompts();
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config, webdav, promptSources: { sources, schedule }, personalPrompts };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    if (!Array.isArray(data.promptSources.sources) || !data.promptSources.schedule || data.promptSources.sources.some((source) => !source || [source.id, source.name, source.url, source.homepage].some((value) => typeof value !== "string") || typeof source.enabled !== "boolean" || typeof source.builtIn !== "boolean")) throw new Error(i18n.t("config.invalidFile"));
    // Validate everything before changing settings. Old files deliberately leave
    // the personal library untouched; imports merge instead of replacing it.
    let conflicts = 0;
    if (data.personalPrompts !== undefined) {
        try { validatePersonalLibrary(data.personalPrompts); }
        catch { throw new Error(i18n.t("personalPrompts.invalidBackup")); }
        conflicts = await importPersonalPrompts(data.personalPrompts);
    }
    useConfigStore.setState({ config: data.config, webdav: data.webdav });
    usePromptSourceStore.setState(data.promptSources);
    return { conflicts };
}
