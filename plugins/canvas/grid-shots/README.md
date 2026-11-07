# 宫格节点插件

Infinite Canvas 画布节点插件:按预设(九宫格多机位、四宫格剧情推演、角色三视图、25 宫格连贯分镜)生成一张宫格大图,再在浏览器内自动切分成对应数量的图片节点,大图与切分图都铺在节点右侧并从本节点连线。

- 上游图片节点(或输出图片资源的插件节点)作为参考图;无上游图片也可运行。
- 补充描述拼在预设提示词后;模型、尺寸可选。生成走 `ctx.ai.generateImage`,复用宿主模型配置。

## 构建

官方插件统一在 `plugins/canvas/registry` 构建(`npm run build`,产物 `dist/grid-shots.js`)。单独开发时:

```bash
npm install
npm run build      # 产物 dist/grid-shots.js,并同步到 web/public/plugins/grid-shots.js
npm run dev        # watch
```

## 测试

```bash
bun test           # src/logic.test.ts:预设格数、提示词拼接、切分矩形
```

插件契约见 `plugins/canvas/README.md`。
