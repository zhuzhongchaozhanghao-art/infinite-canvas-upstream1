# 工作流模板节点插件

Infinite Canvas 画布节点插件:把一个**组**连到「工作流模板」节点,点「存为模板」即可保存组内节点、节点间连线和节点设置(含图片);之后在模板列表点「插入」,会在模板节点右侧按原相对布局铺回画布(全部新 ID,连线保持)。模板可重命名、删除,存于插件私有存储,跨画布共享。

## 构建

官方插件统一由 `plugins/canvas/registry` 构建:

```bash
cd plugins/canvas/registry && npm install && npm run build   # 产物 dist/workflow-template.js
```

单测:在本目录 `bun test`(纯逻辑在 `src/logic.ts`)。

插件契约见 `plugins/canvas/README.md`。
