import localforage from "localforage";
import { nanoid } from "nanoid";
import { emptyPersonalLibrary, mergePersonalLibraries, PERSONAL_SOURCE_ID, promptIdentity, validatePersonalLibrary, type PersonalPrompt, type PersonalPromptLibrary } from "@/lib/personal-prompts";

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "personal_prompts", driver: localforage.INDEXEDDB });
const listeners = new Set<() => void>();
let revision = 0;
let pending: Promise<unknown> = Promise.resolve();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("infinite-canvas:personal-prompts");
function changed() {
    revision++;
    listeners.forEach((listener) => listener());
}
if (channel) channel.onmessage = changed;
if (typeof window !== "undefined") window.addEventListener("focus", changed);
export const subscribePersonalPrompts = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
export const getPersonalPromptsRevision = () => revision;

export async function readPersonalPrompts() {
    const saved = await store.getItem<unknown>("library");
    return saved === null ? emptyPersonalLibrary() : validatePersonalLibrary(saved);
}

// Web Locks serialize read-modify-write across tabs. Reject unsupported contexts
// rather than silently overwriting changes made in another window.
async function updateLibrary(update: (library: PersonalPromptLibrary) => PersonalPromptLibrary | Promise<PersonalPromptLibrary>) {
    const run = async () => {
        const library = await update(await readPersonalPrompts());
        await store.setItem("library", library);
        changed();
        channel?.postMessage("changed");
    };
    if (!navigator.locks) throw new Error("personalPrompts.lockRequired");
    const operation = pending.then(() => navigator.locks.request("infinite-canvas:personal-prompts", run));
    pending = operation.catch(() => undefined);
    await operation;
}

export async function savePersonalPrompt(draft: Pick<PersonalPrompt, "title" | "prompt" | "coverUrl" | "tags">, original?: PersonalPrompt) {
    await updateLibrary((library) => {
        const existing = original ? library.items.find((item) => item.id === original.id) : undefined;
        if (original && (!existing || existing.revision !== original.revision)) throw new Error("personalPrompts.editConflict");
        const now = new Date().toISOString();
        const item: PersonalPrompt = { ...draft, id: original?.id || nanoid(), createdAt: original?.createdAt || now, updatedAt: now, revision: nanoid() };
        if (!item.title.trim() || !item.prompt.trim()) throw new Error("personalPrompts.required");
        return validatePersonalLibrary({ ...library, items: existing ? library.items.map((record) => (record.id === item.id ? item : record)) : [item, ...library.items] });
    });
}

export async function deletePersonalPrompt(original: PersonalPrompt) {
    await updateLibrary((library) => {
        if (library.items.find((item) => item.id === original.id)?.revision !== original.revision) throw new Error("personalPrompts.editConflict");
        const pins = { ...library.pins };
        delete pins[promptIdentity(PERSONAL_SOURCE_ID, original.id)];
        return { ...library, items: library.items.filter((item) => item.id !== original.id), pins };
    });
}

export async function togglePromptPin(sourceId: string, id: string) {
    await updateLibrary((library) => {
        const pins = { ...library.pins };
        const key = promptIdentity(sourceId, id);
        if (pins[key]) delete pins[key];
        else {
            const next = Object.values(pins).reduce((latest, time) => Math.max(latest, time + 1), Date.now());
            if (!Number.isSafeInteger(next)) throw new Error("personalPrompts.invalidBackup");
            pins[key] = next;
        }
        return { ...library, pins };
    });
}

export async function importPersonalPrompts(value: unknown) {
    const incoming = validatePersonalLibrary(value);
    let conflicts = 0;
    await updateLibrary(async (current) => {
        const merged = await mergePersonalLibraries(current, incoming);
        conflicts = merged.conflicts;
        return merged.library;
    });
    return conflicts;
}
