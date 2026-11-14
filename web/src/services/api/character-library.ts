import localforage from "localforage";
import { withLocalProxy } from "@/stores/use-config-store";
import { readCharacterDetail, readCharacterIndex, safeCharacterPath, type CharacterRole } from "@/plugins/character-library/catalog";

export const CHARACTER_LIBRARY_DEMO = "/character-library-demo/index.json";
type DirectoryHandle = {
    name: string;
    getDirectoryHandle: (name: string) => Promise<DirectoryHandle>;
    getFileHandle: (name: string) => Promise<{ getFile: () => Promise<File> }>;
    queryPermission: (options: { mode: "read" }) => Promise<PermissionState>;
    requestPermission: (options: { mode: "read" }) => Promise<PermissionState>;
};
export type CharacterSource = {
    key: string;
    label: string;
    roles: CharacterRole[];
    json: (path: string, signal?: AbortSignal) => Promise<unknown>;
    image: (path: string, signal?: AbortSignal) => Promise<Blob>;
    preview: (path: string) => Promise<{ url: string; revoke: () => void }>;
};
const settings = localforage.createInstance({ name: "infinite-canvas", storeName: "character_library" });

export function characterAssetUrl(path: string, base: string) {
    const url = new URL(path, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("characterLibrary.invalidUrl");
    return url.toString();
}

async function readUrl(url: string, signal?: AbortSignal) {
    const response = await fetch(withLocalProxy(url), { signal, credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
}

export async function openCharacterUrl(input: string, signal?: AbortSignal): Promise<CharacterSource> {
    const url = characterAssetUrl(input.trim(), window.location.href);
    const roles = readCharacterIndex(await (await readUrl(url, signal)).json());
    return {
        key: url,
        label: url,
        roles,
        json: async (path, requestSignal) => (await readUrl(characterAssetUrl(path, url), requestSignal)).json(),
        image: async (path, requestSignal) => (await readUrl(characterAssetUrl(path, url), requestSignal)).blob(),
        preview: async (path) => ({ url: characterAssetUrl(path, url), revoke() {} }),
    };
}

async function directoryFile(root: DirectoryHandle, path: string) {
    const parts = safeCharacterPath(path);
    let directory = root;
    for (const name of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(name);
    return (await directory.getFileHandle(parts.at(-1)!)).getFile();
}

async function openCharacterDirectory(handle: DirectoryHandle): Promise<CharacterSource> {
    const roles = readCharacterIndex(JSON.parse(await (await directoryFile(handle, "index.json")).text()));
    return {
        key: `directory:${handle.name}`,
        label: handle.name,
        roles,
        json: async (path) => JSON.parse(await (await directoryFile(handle, path)).text()),
        image: async (path) => directoryFile(handle, path),
        preview: async (path) => {
            const url = URL.createObjectURL(await directoryFile(handle, path));
            return { url, revoke: () => URL.revokeObjectURL(url) };
        },
    };
}

export async function chooseCharacterDirectory() {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: "read" }) => Promise<DirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error("characterLibrary.directoryUnavailable");
    const handle = await picker.call(window, { mode: "read" });
    const source = await openCharacterDirectory(handle);
    await settings.setItem("source", { kind: "directory", handle });
    return source;
}

export async function saveCharacterUrl(url: string, signal?: AbortSignal) {
    const source = await openCharacterUrl(url, signal);
    await settings.setItem("source", { kind: "url", url: source.key });
    return source;
}

export async function restoreCharacterSource(signal?: AbortSignal) {
    const value = await settings.getItem<{ kind: string; url?: string; handle?: DirectoryHandle }>("source");
    if (value?.kind === "directory" && value.handle) {
        if ((await value.handle.queryPermission({ mode: "read" })) !== "granted") throw new Error("characterLibrary.reconnectDirectory");
        return openCharacterDirectory(value.handle);
    }
    return openCharacterUrl(value?.url || CHARACTER_LIBRARY_DEMO, signal);
}

export async function loadCharacterDetail(source: CharacterSource, role: CharacterRole, signal?: AbortSignal) {
    return readCharacterDetail(role, role.metadata ? await source.json(role.metadata, signal) : undefined);
}
