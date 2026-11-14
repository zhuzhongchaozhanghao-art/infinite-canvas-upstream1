import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";
import { personalPromptsEn, personalPromptsZh } from "./personal-prompts";
import { characterLibraryEn, characterLibraryZh } from "./character-library";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "infinite-canvas:locale";

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: { ...zhCN, personalPrompts: personalPromptsZh, characterLibrary: characterLibraryZh } },
        "en-US": { translation: { ...enUS, personalPrompts: personalPromptsEn, characterLibrary: characterLibraryEn } },
    },
    lng: (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale) || "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return i18n.changeLanguage(locale);
}

export default i18n;
