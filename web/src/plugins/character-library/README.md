# AI 角色库

此版本自带的面板插件，入口位于画布底部工具栏；在「节点管理 → 官方插件」中启停。无需创建管理节点，不增加左侧页签。

## 使用素材

- 内置示例：来自本地角色库的一个实际角色，封面和四张原图约 9 MB，仅用于预览验收。
- 本机目录：在素材库设置中选择包含 `index.json` 的素材库根目录，只读访问；刷新后如浏览器要求重新授权，重新选择目录即可。目录授权与当前网站域名绑定。
- 清单网址：填写 HTTP/HTTPS 的 `index.json` 地址。支持现有导出结构：索引角色含 `metadata` 相对路径，角色 JSON 中的 `localFiles` 指向同目录文件。网址来源需允许跨域读取清单和原图，沿用应用已有本地代理设置。

也可把四张图直接声明在索引角色的 `files` 中。格式如下（图片路径相对清单地址解析）：

```json
{
  "schemaVersion": 1,
  "roles": [{
    "id": "role-001",
    "name": "角色名称",
    "category": "现代都市·现代",
    "preview": "role-001/cover.jpg",
    "attributes": {"性别": "男", "年龄段": "中年"},
    "tags": ["职场"],
    "files": [
      {"label": "角色立绘", "url": "role-001/full-body.jpg"},
      {"label": "肖像特写", "url": "role-001/portrait.jpg"},
      {"label": "表情九宫格", "url": "role-001/expressions.jpg"},
      {"label": "三视图", "url": "role-001/views.jpg"}
    ]
  }]
}
```

角色 ID 唯一；四个原图标签必须各出现一次。封面仅供浏览，不替代任何原图。现有导出同时包含 `localFiles` 与原站 `files` 时，优先使用实际保存的 `localFiles`。

## 应用到画布

点击封面打开详情，再点击「应用到画布」。四张图保持原始比例，排列为肖像/三视图在上、立绘/表情在下；创建一个普通组和四个普通图片节点。不调用生成接口。全部图片成功保存后才修改画布；中途失败或取消时清理本次新存储。

已应用的图片使用宿主图片存储，参与原有画布导出和恢复；停用角色库插件不影响已有图片组。整个角色库及本机目录权限不随画布 ZIP 分发。

## 插件接口

`CanvasPlugin.panels` 为可选的底部面板入口；节点插件继续使用原来的 `nodes`。纯面板插件设置 `nodes: []`，面板接收 `CanvasPluginHost`，并在停用时移除入口。角色库随应用编译提供，使用 `builtin:character-library` 安装标识，不从外部执行 JS。

验证：`cd web` 后运行 `bun test tests/character-library.test.ts` 或 `bun test`。
