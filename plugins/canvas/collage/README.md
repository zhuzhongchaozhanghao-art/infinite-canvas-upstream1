# 拼图合成节点插件

Infinite Canvas 画布节点插件:收集上游所有图片按网格排版,节点内实时预览,「导出为图片」在节点右侧生成一个新的图片节点(PNG),可再作为参考图使用。

- 设置项:列数(1–6)、间距(0–80px)、背景色、单元格比例(按原图 / 1:1 / 3:4 / 4:3 / 9:16),均存于节点 metadata。
- 顺序默认按连线顺序;拖动节点内缩略图可调整,顺序存 `metadata.collageOrder`。
- 「按原图」时图片在单元格内完整显示(contain),固定比例时裁切填满(cover)。导出每格宽 1024px。

## 构建

官方插件统一由 `plugins/canvas/registry` 构建(`npm run build`,产物 `dist/collage.js`)。单独开发时:

```bash
npm install
npm run build      # 产物 dist/collage.js,并同步到 web/public/plugins/collage.js
npm test           # 等价于 bun test,运行 src/logic.test.ts
```

插件契约见 `plugins/canvas/README.md`。
