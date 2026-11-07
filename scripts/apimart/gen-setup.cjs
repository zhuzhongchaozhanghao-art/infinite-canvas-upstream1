const fs = require("fs");
const txt = fs.readFileSync(__dirname + "/text-script.js", "utf8"), img = fs.readFileSync(__dirname + "/image-script.js", "utf8"), vid = fs.readFileSync(__dirname + "/video-script.js", "utf8");
const channel = {
  id: "apimart", name: "APIMart", baseUrl: "https://api.apimart.ai/v1", apiFormat: "openai",
  apiKey: process.argv[2] || "",
  models: [
    ...["gemini-nano-banana-2.1", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "flux-3-image"].map((name) => ({ name, capability: "image", script: img })),
    ...["deepseek-v4.1-flash", "gpt-6-luna", "glm-5.3-flash"].map((name) => ({ name, capability: "text", script: txt })),
    { name: "MiniMax-H3-Max", capability: "video", script: vid },
  ],
};
fs.writeFileSync(__dirname + "/setup-apimart.js", `// 在无限画布页面按 F12 打开控制台，粘贴运行：添加/更新 APIMart 渠道，保留其他渠道
(() => {
  const KEY = "infinite-canvas:ai_config_store";
  const channel = ${JSON.stringify(channel)};
  const store = JSON.parse(localStorage.getItem(KEY) || '{"state":{},"version":0}');
  store.state.config = store.state.config || {};
  store.state.config.channels = [...(store.state.config.channels || []).filter((item) => item.id !== channel.id), channel];
  localStorage.setItem(KEY, JSON.stringify(store));
  location.reload();
})();
`);
