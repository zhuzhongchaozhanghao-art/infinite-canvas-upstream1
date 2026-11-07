export const PERSONAL_SOURCE_ID = "local:personal-prompts";

export type PersonalPrompt = {
    id: string;
    title: string;
    prompt: string;
    coverUrl: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    revision: string;
};
export type PersonalPromptLibrary = { version: 1; items: PersonalPrompt[]; pins: Record<string, number> };
export const emptyPersonalLibrary = (): PersonalPromptLibrary => ({ version: 1, items: [], pins: {} });
export const promptIdentity = (sourceId: string, id: string) => JSON.stringify([sourceId, id]);

export function validatePersonalLibrary(value: unknown): PersonalPromptLibrary {
    const library = value as PersonalPromptLibrary;
    if (!library || library.version !== 1 || !Array.isArray(library.items) || !library.pins || typeof library.pins !== "object" || Array.isArray(library.pins)) throw new Error("personalPrompts.invalidBackup");
    const ids = new Set<string>();
    const items = library.items.map((item) => {
        if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error("personalPrompts.invalidBackup");
        if (typeof item.title !== "string" || !item.title.trim() || typeof item.prompt !== "string" || !item.prompt.trim()) throw new Error("personalPrompts.invalidBackup");
        if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string")) throw new Error("personalPrompts.invalidBackup");
        if (typeof item.coverUrl !== "string" || (item.coverUrl && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.coverUrl))) throw new Error("personalPrompts.invalidBackup");
        if (typeof item.revision !== "string" || !item.revision || typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") throw new Error("personalPrompts.invalidBackup");
        if (!Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error("personalPrompts.invalidBackup");
        ids.add(item.id);
        return { id: item.id, title: item.title, prompt: item.prompt, coverUrl: item.coverUrl, tags: [...item.tags], createdAt: item.createdAt, updatedAt: item.updatedAt, revision: item.revision };
    });
    const pins: Record<string, number> = {};
    for (const [key, time] of Object.entries(library.pins)) {
        const identity: unknown = JSON.parse(key);
        if (!Array.isArray(identity) || identity.length !== 2 || identity.some((part) => typeof part !== "string" || !part) || !Number.isSafeInteger(time) || time <= 0) throw new Error("personalPrompts.invalidBackup");
        pins[promptIdentity(identity[0], identity[1])] = time;
    }
    return { version: 1, items, pins };
}

export function sortPinnedPrompts<T extends { id: string; sourceId: string }>(items: T[], pins: Record<string, number>) {
    // Sort the complete filtered collection BEFORE pagination; equal ranks retain source order.
    return [...items].sort((a, b) => (pins[promptIdentity(b.sourceId, b.id)] || 0) - (pins[promptIdentity(a.sourceId, a.id)] || 0));
}

export async function mergePersonalLibraries(current: PersonalPromptLibrary, incoming: PersonalPromptLibrary) {
    const items = [...current.items];
    const pins = { ...current.pins };
    let conflicts = 0;
    for (const item of incoming.items) {
        const existing = items.find((record) => record.id === item.id);
        const content = JSON.stringify([item.title, item.prompt, item.coverUrl, item.tags]);
        let id = item.id;
        if (existing && JSON.stringify([existing.title, existing.prompt, existing.coverUrl, existing.tags]) !== content) {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
            id = `${item.id}:import:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
            conflicts++;
        }
        if (!items.some((record) => record.id === id)) items.push({ ...item, id });
        const incomingPin = incoming.pins[promptIdentity(PERSONAL_SOURCE_ID, item.id)];
        if (incomingPin && !pins[promptIdentity(PERSONAL_SOURCE_ID, id)]) pins[promptIdentity(PERSONAL_SOURCE_ID, id)] = incomingPin;
    }
    for (const [key, time] of Object.entries(incoming.pins)) {
        if (JSON.parse(key)[0] !== PERSONAL_SOURCE_ID && !pins[key]) pins[key] = time;
    }
    return { library: { version: 1 as const, items, pins }, conflicts };
}
