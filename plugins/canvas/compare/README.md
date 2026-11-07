# 对比节点(compare)

取上游连入的前两张图片进行对比:

- **滑块**:左侧为第一张、右侧为第二张,在图上按住拖动分隔线(0–100%,默认 50%)。
- **并排**:两张图左右各占一半。

模式保存在节点 `metadata.compareMode`(`"slider"` / `"side"`)。纯展示节点,不调用模型,不作为上游资源输出。不足两张图时提示「连入两张图片进行对比」。

## 开发

官方插件统一由 `plugins/canvas/registry` 构建(`cd ../registry && npm run build`)。单测:`bun test`。
