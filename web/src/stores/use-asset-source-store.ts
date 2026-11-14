import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { localForageStorage } from "@/lib/localforage-storage";
import { DEFAULT_ASSET_FEEDS, type AssetFeed } from "@/plugins/character-library/asset-catalog";

export const useAssetSourceStore = create<{ sources: AssetFeed[]; save: (feed: AssetFeed) => void; toggle: (id: string, enabled: boolean) => void; remove: (id: string) => void }>()(
    persist(
        (set) => ({
            sources: DEFAULT_ASSET_FEEDS,
            save: (feed) => set((state) => ({ sources: state.sources.some((s) => s.id === feed.id) ? state.sources.map((s) => (s.id === feed.id ? feed : s)) : [...state.sources, feed] })),
            toggle: (id, enabled) => set((state) => ({ sources: state.sources.map((s) => (s.id === id ? { ...s, enabled } : s)) })),
            remove: (id) => set((state) => ({ sources: state.sources.filter((s) => s.id !== id || s.builtIn) })),
        }),
        { name: "infinite-canvas:asset_sources", storage: createJSONStorage(() => localForageStorage) },
    ),
);
