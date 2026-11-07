import { beforeEach, expect, mock, test } from "bun:test";
import { emptyPersonalLibrary, mergePersonalLibraries, PERSONAL_SOURCE_ID, promptIdentity, sortPinnedPrompts, validatePersonalLibrary, type PersonalPrompt } from "../src/lib/personal-prompts";

// Keep browser/store module mocks out of unrelated suites in Bun's shared module cache.
if (process.env.PERSONAL_PROMPT_TEST_CHILD !== "1") {
    test("personal prompt persistence and backup contracts with isolated browser mocks", async () => {
        const child = Bun.spawn([process.execPath, "test", import.meta.path], { env: { ...process.env, PERSONAL_PROMPT_TEST_CHILD: "1" }, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({ code, output: code ? stdout + stderr : "passed" }).toEqual({ code: 0, output: "passed" });
    });
} else {
    let saved: unknown = null;
    let failWrite = false;
    let exported: Blob | undefined;
    let settingsChanges = 0;
    mock.module("file-saver", () => ({
        saveAs: (blob: Blob) => {
            exported = blob;
        },
    }));
    mock.module("@/i18n", () => ({ default: { t: (key: string) => key } }));
    mock.module("@/stores/use-config-store", () => ({
        useConfigStore: {
            getState: () => ({ config: { channels: [] }, webdav: {} }),
            setState: () => {
                settingsChanges++;
            },
        },
    }));
    mock.module("@/stores/use-prompt-source-store", () => ({
        usePromptSourceStore: {
            getState: () => ({ sources: [], schedule: {} }),
            setState: () => {
                settingsChanges++;
            },
        },
    }));
    mock.module("localforage", () => ({
        default: {
            createInstance: () => ({
                getItem: async () => structuredClone(saved),
                setItem: async (_key: string, value: unknown) => {
                    if (failWrite) throw new Error("QuotaExceededError");
                    saved = structuredClone(value);
                },
            }),
        },
    }));
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (_key: string, callback: () => unknown) => callback() } } });
    const { savePersonalPrompt, readPersonalPrompts, deletePersonalPrompt, importPersonalPrompts, togglePromptPin, getPersonalPromptsRevision } = await import("../src/services/personal-prompts");
    const { exportAppConfig, importAppConfig } = await import("../src/services/config-file");
    const item: PersonalPrompt = { id: "one", title: "Portrait", prompt: "Soft daylight", tags: ["photo"], coverUrl: "", createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z", revision: "initial" };
    beforeEach(() => {
        saved = null;
        failWrite = false;
        exported = undefined;
        settingsChanges = 0;
    });

    test("backup round trip preserves cover and source-qualified pins; reimport is idempotent", async () => {
        const coverUrl = "data:image/png;base64,iVBORw0KGgo=";
        const backup = { version: 1 as const, items: [{ ...item, coverUrl }], pins: { [promptIdentity(PERSONAL_SOURCE_ID, item.id)]: 42, [promptIdentity("remote", item.id)]: 43 } };
        await importPersonalPrompts(JSON.parse(JSON.stringify(backup)));
        await importPersonalPrompts(backup);
        expect(await readPersonalPrompts()).toEqual(backup);
    });

    test("conflicting imports preserve the current item and keep a deterministic separate copy", async () => {
        const current = { ...emptyPersonalLibrary(), items: [item] };
        const incoming = { ...emptyPersonalLibrary(), items: [{ ...item, prompt: "Another prompt" }], pins: { [promptIdentity(PERSONAL_SOURCE_ID, item.id)]: 1 } };
        const first = await mergePersonalLibraries(current, incoming);
        const again = await mergePersonalLibraries(first.library, incoming);
        expect(first.library.items[0]).toEqual(item);
        expect(first.library.items[1].prompt).toBe("Another prompt");
        expect(again.library.items).toEqual(first.library.items);
        expect(first.library.pins[promptIdentity(PERSONAL_SOURCE_ID, first.library.items[1].id)]).toBe(1);
    });

    test("invalid backups never modify existing data", async () => {
        saved = { ...emptyPersonalLibrary(), items: [item] };
        for (const invalid of [
            { ...emptyPersonalLibrary(), version: 2 },
            { ...emptyPersonalLibrary(), items: [item, item] },
            { ...emptyPersonalLibrary(), items: [{ ...item, coverUrl: "blob:temporary" }] },
            { ...emptyPersonalLibrary(), pins: { broken: 1 } },
            { ...emptyPersonalLibrary(), pins: { [promptIdentity("remote", "one")]: Infinity } },
        ]) {
            expect(() => validatePersonalLibrary(invalid)).toThrow();
            await expect(importPersonalPrompts(invalid)).rejects.toThrow();
            expect((await readPersonalPrompts()).items).toEqual([item]);
        }
    });

    test("pins sort before pagination and do not leak to matching IDs from another source", () => {
        const items = Array.from({ length: 45 }, (_, index) => ({ sourceId: "remote", id: String(index) }));
        const other = { sourceId: "other", id: "44" };
        const sorted = sortPinnedPrompts([...items, other], { [promptIdentity("remote", "44")]: 1 });
        expect(sorted.slice(0, 20)[0]).toEqual(items[44]);
        expect(sorted.at(-1)).toEqual(other);
        expect(items[0].id).toBe("0");
    });

    test("parallel saves retain both records; stale edits and deleted prompts never overwrite newer data", async () => {
        await Promise.all([savePersonalPrompt(item), savePersonalPrompt({ ...item, title: "Other" })]);
        const original = (await readPersonalPrompts()).items[0];
        expect((await readPersonalPrompts()).items).toHaveLength(2);
        await savePersonalPrompt({ ...original, prompt: "Edited" }, original);
        await expect(savePersonalPrompt({ ...original, prompt: "Stale" }, original)).rejects.toThrow("editConflict");
        const updated = (await readPersonalPrompts()).items.find((record) => record.id === original.id)!;
        await deletePersonalPrompt(updated);
        await expect(savePersonalPrompt(original, original)).rejects.toThrow("editConflict");
        expect((await readPersonalPrompts()).items).toHaveLength(1);
    });

    test("failed writes leave data and revision unchanged; pin toggling is persisted", async () => {
        saved = { ...emptyPersonalLibrary(), items: [item] };
        const revision = getPersonalPromptsRevision();
        failWrite = true;
        await expect(savePersonalPrompt({ ...item, prompt: "Lost edit" }, item)).rejects.toThrow("QuotaExceededError");
        expect(getPersonalPromptsRevision()).toBe(revision);
        expect((await readPersonalPrompts()).items[0]).toEqual(item);
        failWrite = false;
        await togglePromptPin(PERSONAL_SOURCE_ID, item.id);
        expect((await readPersonalPrompts()).pins[promptIdentity(PERSONAL_SOURCE_ID, item.id)]).toBeGreaterThan(0);
        await togglePromptPin(PERSONAL_SOURCE_ID, item.id);
        expect((await readPersonalPrompts()).pins).toEqual({});
    });

    test("configuration export contains personal data, and legacy imports preserve it", async () => {
        saved = { ...emptyPersonalLibrary(), items: [item], pins: { [promptIdentity("remote", "one")]: 1 } };
        await exportAppConfig();
        const backup = JSON.parse(await exported!.text());
        expect(backup.personalPrompts).toEqual(saved);
        const { personalPrompts: _personal, ...legacy } = backup;
        await importAppConfig(new File([JSON.stringify(legacy)], "legacy.json"));
        expect(await readPersonalPrompts()).toEqual(saved);
        expect(settingsChanges).toBe(2);
    });

    test("bad personal backup or source settings are rejected before changing any settings", async () => {
        saved = { ...emptyPersonalLibrary(), items: [item] };
        const base = { app: "infinite-canvas", version: 1, config: {}, webdav: {}, promptSources: { sources: [], schedule: {} } };
        for (const data of [
            { ...base, personalPrompts: { version: 99 } },
            { ...base, promptSources: { sources: null }, personalPrompts: emptyPersonalLibrary() },
        ]) {
            await expect(importAppConfig(new File([JSON.stringify(data)], "bad.json"))).rejects.toThrow();
            expect(settingsChanges).toBe(0);
            expect((await readPersonalPrompts()).items).toEqual([item]);
        }
    });
}
