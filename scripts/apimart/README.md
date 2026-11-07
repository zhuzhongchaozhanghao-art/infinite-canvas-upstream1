# APIMart 渠道脚本

APIMart（https://api.apimart.ai/v1）生图和视频是异步任务接口，文本 GLM 不支持 `/v1/responses`，所以三类模型都用自定义调用脚本。

| 文件 | 适用模型 | 要点 |
| --- | --- | --- |
| `image-script.js` | gemini-nano-banana-2.1、gpt-image-2.5-flare、gpt-image-2.5-sunburst、flux-3-image | 提交 `/images/generations`，轮询 `/tasks/{id}`；像素尺寸换成最近的支持比例；结果 24 小时过期，下载成 data URL |
| `video-script.js` | MiniMax-H3-Max | 参考图先传 `/uploads/images` 换公网链接；1-2 张按首尾帧；480p/720p/1080p → 480P/768P/1080P；不支持参考视频/音频 |
| `text-script.js` | deepseek-v4.1-flash、gpt-6-luna、glm-5.3-flash | 走 `/chat/completions` 流式，只输出正文 |

脚本里的路径不带 `/v1`，`buildApiUrl` 会自动补。

## 写入浏览器

```bash
node scripts/apimart/gen-setup.cjs <APIMart API Key>
```

生成同目录的 `setup-apimart.js`（含 Key，已加入 .gitignore），在画布页面控制台粘贴运行即可：只增改 id 为 `apimart` 的渠道，保留其他渠道。
