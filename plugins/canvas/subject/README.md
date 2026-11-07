# 主体节点插件

Infinite Canvas 画布节点插件:一个节点代表一个主体(角色、商品等),包含名称、类型、简短描述与 1–4 张参考图。

- 参考图可上传,或「从上游取图」把上游图片节点的图加入;最多 4 张。
- 连到生成节点时作为参考图输出全部图片;开启「描述拼进提示词」后额外附带一条「名称：描述」文本引用。
- 「存入主体库」写入插件存储(键 `subjects`,同 id 覆盖,跨画布共享);「从库中选择」载入到当前节点,库内可重命名、删除。

## 构建

官方插件统一在 `plugins/canvas/registry` 构建(`npm run build`,产物 `dist/subject.js`)。单独开发时:

```bash
npm install
npm run build      # 产物 dist/subject.js,并同步到 web/public/plugins/subject.js
npm test           # 纯逻辑单测(src/logic.test.ts)
```

插件契约见 `plugins/canvas/README.md`。
