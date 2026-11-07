import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";
import { Readable } from "node:stream";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const match = /^\/image-source\/(pub-[a-f0-9]{32})\/(generated\/[^#]*)$/.exec(req.url || "");
                if (!match) return next();
                if (req.method !== "GET" && req.method !== "HEAD") {
                    res.writeHead(405).end();
                    return;
                }
                try {
                    const response = await fetch(`https://${match[1]}.r2.dev/${match[2]}`, { method: req.method, redirect: "error" });
                    res.statusCode = response.status;
                    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
                    res.setHeader("X-Content-Type-Options", "nosniff");
                    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
                    if (!response.body) return void res.end();
                    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
                } catch {
                    res.writeHead(502).end();
                }
            });
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});
