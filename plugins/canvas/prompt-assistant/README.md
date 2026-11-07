# 提示词助手节点（prompt-assistant）

读取上游文本节点与图片（作为多模态输入），按预设模式调用文本模型，产出可直接编辑的文本，并作为文本资源连给下游生成节点。

- 模式：扩写、精简、翻译成英文、服装描述（按 款式 / 面料 / 颜色 / 细节 输出）、自定义（自填系统提示词）。
- 补充说明、文本模型可选；流式输出，可取消、可重新生成；失败时保留旧结果。
- 生成只走 `ctx.ai.generateText`，插件内不含任何 Key。

## 开发

```bash
bun test          # 纯逻辑单测(src/logic.test.ts)
npm run build     # 需先 npm install;官方构建走 plugins/canvas/registry
```
