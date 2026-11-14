import localforage from "localforage";
import { withLocalProxy } from "@/stores/use-config-store";
import { readReferenceAssets, type AssetFeed, type ReferenceAsset } from "@/plugins/character-library/asset-catalog";

const cache = localforage.createInstance({ name: "infinite-canvas", storeName: "asset_catalogs" });
export type AssetFeedResult = { items: ReferenceAsset[]; fetchedAt: string; stale: boolean };

export async function loadAssetFeed(feed: AssetFeed, refresh = false, signal?: AbortSignal): Promise<AssetFeedResult> {
    // URL and asset base both belong in the key; changing a source never reuses unrelated data.
    const key = `${feed.id}:${feed.url}:${feed.baseUrl}`;
    const saved = await cache.getItem<{ raw: unknown; fetchedAt: string }>(key);
    if (saved && !refresh) return { items: readReferenceAssets(saved.raw, feed), fetchedAt: saved.fetchedAt, stale: false };
    try {
        const response = await fetch(withLocalProxy(feed.url), { signal, credentials: "omit" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw: unknown = await response.json();
        const items = readReferenceAssets(raw, feed);
        signal?.throwIfAborted();
        const fetchedAt = new Date().toISOString();
        await cache.setItem(key, { raw, fetchedAt });
        return { items, fetchedAt, stale: false };
    } catch (error) {
        if (signal?.aborted || !saved) throw error;
        return { items: readReferenceAssets(saved.raw, feed), fetchedAt: saved.fetchedAt, stale: true };
    }
}

export async function fetchReferenceImage(url: string, signal: AbortSignal) {
    const response = await fetch(withLocalProxy(url), { signal, credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
}
