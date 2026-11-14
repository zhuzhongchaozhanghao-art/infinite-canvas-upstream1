import i18n from "@/i18n";

export const CHARACTER_LIBRARY_PLUGIN_URL = "builtin:character-library";
export const bundledPluginEntries = [
    {
        id: "character-library",
        version: "1.0.0",
        url: CHARACTER_LIBRARY_PLUGIN_URL,
        icon: "👥",
        get name() {
            return i18n.t("characterLibrary.title");
        },
        get description() {
            return i18n.t("characterLibrary.pluginDescription");
        },
    },
];

export async function readBundledPlugin(url: string) {
    if (url !== CHARACTER_LIBRARY_PLUGIN_URL) throw new Error("Unknown bundled plugin");
    return (await import("@/plugins/character-library")).default;
}
