# 画布新节点包（第一期） Implementation Plan

**Goal:** 以 8 个官方插件交付列表批量、提示词助手、拼图合成、对比、宫格、分镜脚本、主体、工作流模板节点，均可在节点管理器启停。
**Architecture:** 宿主只补两处插件能力（文本生成带图、插件资源输出多图）并让插件参考图接受任意图片地址；共用的纯逻辑（网格布局、铺图指令）放进 SDK 的 `canvas-utils`；每个节点是 `plugins/canvas/<dir>` 独立插件，在 `registry/build.mjs` 的 `OFFICIAL` 登记。
**Tech Stack:** React 19（宿主）、`@infinite-canvas/plugin-sdk`、esbuild、bun test、TypeScript。

Spec：`docs/specs/2026-10-23-canvas-node-pack.md`

## Global Constraints

- 每个插件一个独立目录，结构照抄 `plugins/canvas/template`（`package.json` / `build.mjs` / `tsconfig.json` / `src/index.tsx` / `README.md`），插件 `id` 即目录名，节点 `type` 为 `<id>:<name>`。
- 插件版本 `1.0.0`，`package.json` 与 `definePlugin({version})` 一致。
- 生成只走 `ctx.ai`，插件内不出现 Key、不直接请求模型接口。
- 交互控件外层带 `data-canvas-no-zoom` 并阻止 `mousedown` 冒泡；颜色只用 `ctx.theme`。
- 插件 UI 文案用中文；代码与标识符英文，注释中文。
- 宿主改动向后兼容：已有插件（markdown、svg、html、panorama、sticky-note）不改也能正常工作。
- 宿主类型 `web/src/types/canvas-plugin.ts` 与 SDK 类型 `plugins/canvas/sdk/src/types.ts` 同步修改。
- 视频工具、费用预估、增量重跑、路由节点、发布到 `plugins-dist` 均不做。

## 文件结构

| 路径 | 职责 |
|---|---|
| `web/src/types/canvas-plugin.ts`、`plugins/canvas/sdk/src/types.ts` | 插件能力类型：`GenerateTextOptions.images`、`CanvasNodeResource.urls` |
| `web/src/pages/canvas/hooks/use-plugin-host.tsx` | `ctx.ai` 实现：文本带图、参考图地址转 data URL |
| `web/src/lib/canvas/canvas-resource-references.ts` | 插件资源多图展开成多个参考图 |
| `plugins/canvas/sdk/src/canvas-utils.ts`（导出于 `index.ts`） | 共用纯函数：网格坐标、铺图节点指令、取上游图片/文本 |
| `plugins/canvas/registry/build.mjs` | `OFFICIAL` 登记 8 个新插件 |
| `plugins/canvas/{compare,collage,prompt-assistant,batch-list,grid-shots,storyboard,subject,workflow-template}/` | 各节点插件；纯逻辑放 `src/logic.ts`，测试放 `src/logic.test.ts` |

## Tasks

### Task 1: 宿主能力扩展 + SDK 共用工具

**Files:**
- Modify: `web/src/types/canvas-plugin.ts`、`plugins/canvas/sdk/src/types.ts`
- Modify: `web/src/pages/canvas/hooks/use-plugin-host.tsx`
- Modify: `web/src/lib/canvas/canvas-resource-references.ts`
- Create: `plugins/canvas/sdk/src/canvas-utils.ts`；Modify: `plugins/canvas/sdk/src/index.ts`
- Test: `web/tests/plugin-resource-references.test.ts`、`plugins/canvas/sdk/src/canvas-utils.test.ts`

**Interfaces:**
- Produces:
  - `GenerateTextOptions.images?: string[]`（data URL 或图片地址）
  - `CanvasNodeResource.urls?: string[]`（`kind: "image"` 时多图；有 `urls` 时优先于 `url`）
  - `gridPositions(origin: {x:number;y:number}, count: number, cell: {width:number;height:number}, opts?: {columns?: number; gap?: number}): {x:number;y:number}[]`
  - `buildImageNodeOps(sourceNodeId: string, items: {id: string; title: string; dataUrl: string; width: number; height: number}[], origin: {x:number;y:number}, opts?: {columns?: number; gap?: number; cellWidth?: number}): CanvasAgentOp[]`（add_node image + connect_nodes）
  - `getUpstreamImages(ctx: CanvasNodeContext): string[]`（上游图片节点 `metadata.content`、插件资源 `url/urls`，组展开成员；按连线顺序去重）
  - `getUpstreamText(ctx: CanvasNodeContext): string`（上游文本节点内容与插件 text 资源，`\n\n` 连接）
  - `readImageSize(src: string): Promise<{width:number;height:number}>`

**Requirements:**
- `generateText` 传 `images` 时，user 消息改为 `[{type:"text"}, {type:"image_url"}...]` 多段内容；不传时与现在完全相同。
- 插件 `ai.*` 的 `references` / `images` 中非 `data:` 地址先经 `imageToDataUrl` 转成 data URL 再发送。
- 插件节点 `resource` 返回 `urls`（N 张）时，在参考图列表中展开为 N 条图片引用（`id` 为 `<nodeId>#<i>`，`nodeId` 不变），编号连续；同时带 `text` 时再追加 1 条文本引用（`id` 为 `<nodeId>#text`）；返回单个 `url` 的行为不变。
- `gridPositions` 默认 `columns = ceil(sqrt(count))`、`gap = 40`，按行优先排列。
- `buildImageNodeOps` 生成的图片节点 `metadata` 含 `content`、`status:"success"`、`naturalWidth`、`naturalHeight`、`mimeType`，节点宽默认 `cellWidth = 240`，高按比例。
- 通过 `applyOps` 新增、`content` 为 data URL 的图片节点，刷新页面后仍能显示；若现状不满足，在宿主 `applyAgentOps` 的 add_node 路径里补上与生成结果相同的存储落盘。

**Test cases:**
- 资源 `urls: [a, b]` 的插件节点连入 → 引用列表得到 2 条图片引用，标签「图1」「图2」。
- 资源 `urls: [a, b]` + `text: "t"` → 2 条图片引用 + 1 条文本引用，文本内容为 `t`。
- 资源仅 `url: a` → 1 条引用（回归）。
- `gridPositions({x:0,y:0}, 4, {width:100,height:100})` → `[(0,0),(140,0),(0,140),(140,140)]`。
- `gridPositions(..., 5, ..., {columns: 5})` → 5 个点同一行。
- `buildImageNodeOps("s", 2 项, ...)` → 2 个 add_node + 2 个 connect_nodes，from 均为 `s`。

- [x] **Step 1: 按上述 cases 写失败测试**
- [x] **Step 2: 运行确认失败**：`cd web && bun test tests/plugin-resource-references.test.ts`；`cd plugins/canvas/sdk && bun test`，预期 FAIL
- [x] **Step 3: 最小实现使其通过**
- [x] **Step 4: 运行确认通过**：同上命令 PASS；`cd web && bun run typecheck` 无错误；浏览器里刷新验证 data URL 图片节点持久化
- [x] **Step 5: Commit**

### Task 2: 对比节点（compare）+ 新插件登记方式

**Files:**
- Create: `plugins/canvas/compare/`（照抄 template 结构）
- Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `getUpstreamImages`
- Produces: `OFFICIAL` 登记条目格式 `{ id, dir, name, description, icon }`（后续任务同样登记）

**Requirements:**
- 节点 `compare:node`，标题「对比」，图标 `🔀`，默认尺寸 `480×360`，`hidePanel: true`，无 `resource`。
- 取 `getUpstreamImages` 前两张；不足两张显示「连入两张图片进行对比」。
- 滑块模式：左图为第一张，右图为第二张，拖动分隔线（0–100%，默认 50%）；并排模式：两图左右各半。节点内切换按钮「滑块 / 并排」，模式存 `metadata.compareMode`。
- 登记：`{ id: "compare", dir: "compare", name: "对比节点", description: "两张图片滑块或并排对比", icon: "🔀" }`。

**Test cases:**
- `clampPercent(-5) → 0`，`clampPercent(130) → 100`（`src/logic.ts`）。
- `npm run build` 产出 `dist/compare.js`；registry `npm run build` 的清单含 `compare`。

- [x] **Step 1: 写失败测试** - [x] **Step 2: 确认失败**：`cd plugins/canvas/compare && bun test` FAIL
- [x] **Step 3: 实现** - [x] **Step 4: 确认通过**：`bun test` PASS、`npm run typecheck`、`npm run build`、`cd ../registry && npm run build` 清单含 compare；浏览器启用节点后可见于新建菜单，停用后消失
- [x] **Step 5: Commit**

### Task 3: 拼图合成节点（collage）

**Files:** Create: `plugins/canvas/collage/`；Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `getUpstreamImages`、`readImageSize`、`buildImageNodeOps`
- Produces: `computeCollageLayout(sizes: {width:number;height:number}[], opts: {columns:number; gap:number; cellRatio: "original"|"1:1"|"3:4"|"4:3"|"9:16"; cellWidth:number}): {width:number;height:number; cells:{x:number;y:number;width:number;height:number}[]}`

**Requirements:**
- 节点 `collage:node`，标题「拼图合成」，图标 `🧩`，默认尺寸 `420×420`。
- 设置项：列数（1–6，默认 2）、间距（0–80px，默认 16）、背景色（默认 `#ffffff`）、单元格比例（按原图 / 1:1 / 3:4 / 4:3 / 9:16，默认按原图）；存 metadata。
- 顺序：默认按连线顺序；节点内缩略图可拖动调整，顺序存 `metadata.collageOrder`（节点 id 数组）。
- 「按原图」时单元格高度取该行最高图按 `cellWidth=1024` 缩放后的高度，图片居中 contain；固定比例时 cover 裁切。
- 「导出为图片」：用 canvas 按布局绘制 PNG，以 `buildImageNodeOps` 在节点右侧 80px 处新增 1 个图片节点并连线，标题「拼图 N 张」。
- 登记：`{ id: "collage", dir: "collage", name: "拼图合成节点", description: "上游图片按网格排版导出为一张图", icon: "🧩" }`。

**Test cases:**
- 4 张 100×100、2 列、gap 10、1:1、cellWidth 100 → 画布 210×210，第 4 格在 (110,110)。
- 3 张、2 列 → 2 行，第 3 格在第二行第一列。
- 0 张 → 宽高 0、cells 为空。

- [x] **Step 1–5**：同 Task 2 流程；浏览器验收：连 4 张图、2 列导出，得到新图片节点且排版一致

### Task 4: 提示词助手节点（prompt-assistant）

**Files:** Create: `plugins/canvas/prompt-assistant/`；Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `getUpstreamText`、`getUpstreamImages`、`ai.generateText(prompt, {system, images, model, onDelta, signal})`
- Produces: `buildAssistantRequest(mode: AssistantMode, upstreamText: string, note: string, customSystem?: string): {system: string; prompt: string}`；`type AssistantMode = "expand"|"condense"|"translate-en"|"garment"|"custom"`

**Requirements:**
- 节点 `prompt-assistant:node`，标题「提示词助手」，图标 `🪄`，默认尺寸 `360×320`。
- 模式下拉：扩写、精简、翻译成英文、服装描述、自定义；「自定义」显示系统提示词输入框。「服装描述」要求按 款式 / 面料 / 颜色 / 细节 四项输出。
- 输入框「补充说明」；模型下拉来自 `ai.listModels("text")`，默认 `ai.defaultModel("text")`。
- 「生成」流式写入结果（`onDelta`），完成后结果存 `metadata.content`，可直接编辑；「重新生成」覆盖；生成中可取消。
- 无上游文本、无图片、无补充说明时「生成」禁用。
- `resource: (node) => ({ kind: "text", text: node.metadata?.content })`，有内容时才返回。
- 失败时节点内显示错误信息，保留旧结果。
- 登记：`{ id: "prompt-assistant", dir: "prompt-assistant", name: "提示词助手节点", description: "扩写、精简、翻译、服装描述，支持看图", icon: "🪄" }`。

**Test cases:**
- `buildAssistantRequest("garment", "白衬衫", "")` → system 含「款式」「面料」「颜色」「细节」，prompt 含「白衬衫」。
- `buildAssistantRequest("custom", "a", "b", "S")` → system 为 `S`，prompt 含 `a` 与 `b`。
- 上游与说明均为空 → prompt 为空字符串。

- [x] **Step 1–5**：同 Task 2 流程；浏览器验收：连 1 图 + 1 文本选「服装描述」得到文本，连到图片节点生成时提示词包含该文本

### Task 5: 列表批量节点（batch-list）

**Files:** Create: `plugins/canvas/batch-list/`；Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `getUpstreamImages`、`buildImageNodeOps`、`readImageSize`、`ai.generateImage`
- Produces: `expandCombinations(variables: {name:string; values:string[]}[]): Record<string,string>[]`；`fillTemplate(template: string, combo: Record<string,string>): string`

**Requirements:**
- 节点 `batch-list:node`，标题「列表批量」，图标 `📋`，默认尺寸 `520×420`，`metadata.variables` 存变量表，`metadata.template` 存模板。
- 变量表：增删变量（列名唯一、非空），每列多行取值，空值忽略；无变量时组合数为 1（模板原样）。
- 模板用 `{变量名}` 引用；未定义的变量名保持原样。
- 模型（`listModels("image")`）、尺寸、每条张数（1–4，默认 1）。
- 显示「将生成 N 张」（N = 组合数 × 张数）；N > 50 时点击运行弹出确认「将生成 N 张，确定继续？」。
- 运行：最多并发 3 个请求；每完成一条即用 `buildImageNodeOps` 铺到节点右侧网格并连线，节点标题为组合值以「 / 」连接；失败的条目在节点内列出，可单条「重试」；可整体取消。
- 登记：`{ id: "batch-list", dir: "batch-list", name: "列表批量节点", description: "变量组合批量出图", icon: "📋" }`。

**Test cases:**
- 2 变量各 3 值 → 9 个组合，首个为两变量的首值。
- 某变量含空字符串值 → 该值被忽略。
- 无变量 → `[{}]`。
- `fillTemplate("{a} 穿 {b} 在 {c}", {a:"模特",b:"西装"})` → `"模特 穿 西装 在 {c}"`。

- [x] **Step 1–5**：同 Task 2 流程；浏览器验收：2×3 变量显示 9，运行后 9 个图片节点、标题与连线正确

### Task 6: 宫格节点（grid-shots）

**Files:** Create: `plugins/canvas/grid-shots/`；Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `getUpstreamImages`、`buildImageNodeOps`、`readImageSize`、`ai.generateImage`
- Produces: `GRID_PRESETS: Record<GridPresetId, {label:string; rows:number; columns:number; prompt:string}>`；`type GridPresetId = "multi-angle-9"|"story-4"|"turnaround-3"|"storyboard-25"`；`tileRects(width:number, height:number, rows:number, columns:number): {x:number;y:number;width:number;height:number}[]`

**Requirements:**
- 节点 `grid-shots:node`，标题「宫格」，图标 `🔲`，默认尺寸 `360×300`。
- 预设：九宫格多机位（3×3）、四宫格剧情推演（2×2）、角色三视图（1×3，正/侧/背）、25 宫格连贯分镜（5×5）；每个预设的提示词要求「等分网格、无边框无间隙、主体一致」。
- 自定义补充描述拼在预设提示词后；模型、尺寸可选；上游图片作为参考图，无上游图片也可运行。
- 生成 1 张大图 → 用 `tileRects` 在浏览器 canvas 中切成 rows×columns 张 → 大图 1 个节点 + 切分图按 rows×columns 网格铺开，全部从本节点连线；切分图标题「宫格 i」。
- 登记：`{ id: "grid-shots", dir: "grid-shots", name: "宫格节点", description: "多机位九宫格、剧情四宫格、三视图并自动切分", icon: "🔲" }`。

**Test cases:**
- `tileRects(900, 900, 3, 3)` → 9 个 300×300，第 5 个在 (300,300)。
- `tileRects(1000, 300, 1, 3)` → 宽依次 333/333/334（余数补给最后一列），总和 1000。
- 4 个预设的 rows×columns 分别为 9、4、3、25。

- [x] **Step 1–5**：同 Task 2 流程；浏览器验收：九宫格得到 1 大图 + 9 切分图

### Task 7: 分镜脚本节点（storyboard）

**Files:** Create: `plugins/canvas/storyboard/`；Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `getUpstreamText`、`getUpstreamImages`、`buildImageNodeOps`、`ai.generateText`、`ai.generateImage`、`ai.generateVideo(prompt, {references, seconds, model})`
- Produces: `type StoryboardRow = {id:string; shot:number; seconds:number; framing:string; description:string; subject:string; imageNodeId?:string}`；`parseStoryboard(text: string): StoryboardRow[]`；`buildShotPrompt(row: StoryboardRow): string`

**Requirements:**
- 节点 `storyboard:node`，标题「分镜脚本」，图标 `🎬`，默认尺寸 `720×480`，行数据存 `metadata.rows`。
- 剧本来源：节点内剧本框，为空时用 `getUpstreamText`。「拆分镜」让文本模型只输出 JSON 数组（字段 shot/seconds/framing/description/subject），`parseStoryboard` 容忍 ```json 代码块包裹与前后多余文字；解析失败提示「分镜解析失败，请重试」。
- 表格可编辑全部列、增删行、勾选行；镜号按行序自动重排。
- 「批量出图」：勾选行逐条生成（并发 3），参考图为 `getUpstreamImages`，铺成图片节点，标题「镜 N」，行记录 `imageNodeId`。
- 「批量出视频」：只对勾选且已有 `imageNodeId` 的行可用；以该图为首帧参考、`buildShotPrompt` 为提示词、`seconds` 取行时长调用 `generateVideo`，在对应图片节点右侧新增视频节点并从图片节点连线，标题「镜 N 视频」。
- 登记：`{ id: "storyboard", dir: "storyboard", name: "分镜脚本节点", description: "剧本拆分镜表，批量出图出视频", icon: "🎬" }`。

**Test cases:**
- 纯 JSON 数组（2 条）→ 2 行，shot 为 1、2。
- 被 ```json 包裹且前面有说明文字 → 正常解析。
- 非 JSON → 抛错。
- seconds 缺失或非数字 → 默认 5。
- `buildShotPrompt` 输出包含 framing 与 description。

- [x] **Step 1–5**：同 Task 2 流程；浏览器验收：剧本 → 分镜表；勾 3 行出 3 张带镜号图；勾 1 行出 1 个视频节点

### Task 8: 主体节点（subject）

**Files:** Create: `plugins/canvas/subject/`；Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `CanvasNodeResource.urls`、`ctx.storage`
- Produces: `type SubjectRecord = {id:string; name:string; kind:"character"|"product"|"other"; description:string; images:string[]}`；存储键 `subjects`（`SubjectRecord[]`）

**Requirements:**
- 节点 `subject:node`，标题取主体名称（默认「主体」），图标 `👤`，默认尺寸 `320×360`。
- 字段：名称、类型（角色 / 商品 / 其他）、描述、参考图 1–4 张（上传文件，或「从上游取图」把上游图片节点的图加入）；超过 4 张时禁止添加并提示「最多 4 张参考图」。
- `resource: (node) => ({ kind: "image", urls: images })`，无图时返回 null。
- 「描述拼进提示词」开关（`metadata.appendDescription`，默认关）；开启且描述非空时 resource 额外带 `text: "<名称>：<描述>"`，由 Task 1 的多图资源展开逻辑追加一条文本引用。
- 「存入主体库」写入 `ctx.storage` 的 `subjects`（同 id 覆盖）；「从库中选择」列出全部，点选载入到当前节点；库列表内可重命名、删除。
- 登记：`{ id: "subject", dir: "subject", name: "主体节点", description: "保存角色或商品参考图，跨画布复用", icon: "👤" }`。

**Test cases:**
- `upsertSubject(list, record)`：新 id 追加、同 id 覆盖。
- `removeSubject(list, id)` 删除对应项。
- `addImage(images, url)` 第 5 张时返回错误「最多 4 张参考图」。

- [x] **Step 1–5**：同 Task 2 流程；浏览器验收：2 图主体存库 → 另一画布载入 → 连到生成节点，请求带 2 张参考图

### Task 9: 工作流模板节点（workflow-template）

**Files:** Create: `plugins/canvas/workflow-template/`；Modify: `plugins/canvas/registry/build.mjs`

**Interfaces:**
- Consumes: `ctx.getUpstream`、`ctx.getNodes`、`ctx.getConnections`、`ctx.applyOps`、`ctx.storage`
- Produces: `type WorkflowTemplate = {id:string; name:string; createdAt:number; nodes: TemplateNode[]; connections:{from:string; to:string}[]}`；`type TemplateNode = {key:string; type:string; title:string; dx:number; dy:number; width:number; height:number; metadata: Record<string, unknown>}`；`captureGroup(groupId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): Omit<WorkflowTemplate,"id"|"name"|"createdAt">`；`instantiateTemplate(t: WorkflowTemplate, origin:{x:number;y:number}, newId: () => string): CanvasAgentOp[]`；存储键 `templates`

**Requirements:**
- 节点 `workflow-template:node`，标题「工作流模板」，图标 `🧰`，默认尺寸 `340×380`。
- 「存为模板」仅在有上游组节点时可用；取第一个上游组：组本身 + `metadata.groupId` 等于该组 id 的节点 + 两端都在其中的连线；坐标存为相对组左上角的偏移。
- 保存时去掉运行态字段：`status` 置 `"idle"`（有内容的图片/视频/文本节点保留 `"success"`）、去掉 `videoTaskId`、`errorDetails`。
- 「插入」：在模板节点右侧 80px 处按偏移铺回，全部节点新 id，`groupId` 映射到新组 id，连线按新 id 重建。
- 模板列表可重命名、删除；存 `ctx.storage` 的 `templates`。
- 登记：`{ id: "workflow-template", dir: "workflow-template", name: "工作流模板节点", description: "把一组节点存成模板，一键复用", icon: "🧰" }`。

**Test cases:**
- 组 G 含 3 节点 2 连线，外加 1 条连到组外的线 → 捕获 4 节点（含 G）、2 连线。
- `instantiateTemplate` → 4 个 add_node + 2 个 connect_nodes，新 id 与旧 id 均不同，子节点 `groupId` 指向新组 id。
- 偏移：组在 (100,100)、子节点在 (150,180) → dx 50、dy 80；以 origin (0,0) 插入后子节点在 (50,80)。
- 捕获后 `errorDetails`、`videoTaskId` 不存在。

- [x] **Step 1–5**：同 Task 2 流程；浏览器验收：3 节点 2 连线的组存模板，插入后相对位置与连线一致

### Task 10: 总验收与收尾

**Files:** Modify: `plugins/canvas/README.md`（内置/插件列表一句话补充）、`PROJECT.md`

**Requirements:**
- `cd plugins/canvas/registry && npm install && npm run build`：清单 13 个插件（原 5 + 新 8）。
- 8 个插件在节点管理器逐个启用 → 新建菜单出现；逐个停用 → 消失，控制台无报错。
- 原 5 个插件随机抽 2 个确认行为不变。
- `cd web && bun run typecheck && bun test` 全部通过。
- 对照 spec 验收标准 1–11 逐条打勾，未通过项在本 plan 末尾记录。

- [x] **Step 1: 跑上述命令并截图验收**
- [x] **Step 2: 更新 PROJECT.md，Commit**

## 进展备注

（每完成一个任务在此追加一行）

- 2026-10-23 Task 1 完成：多图资源/文本带图/参考图转 data URL 落地，SDK 新增 canvas-utils；另加 `ctx.getResource`（SDK 侧可选）供 getUpstreamImages 读插件资源，生成链路 canvas-node-generation 同步展开多图；data URL 图片节点持久化经代码确认无需改动（未浏览器实测）。
- 2026-10-23 Task 2 完成：对比节点（滑块/并排，模式存 compareMode）；no-zoom 与 mousedown 拦截只加在交互控件上以保留节点拖动；浏览器验收并入 Task 10。
- 2026-10-23 Task 3 完成：拼图合成节点（网格排版、拖动排序、canvas 导出 PNG）；实际列数取 min(列数, 张数)，固定比例也按 cellWidth 1024 导出；浏览器验收并入 Task 10。
- 2026-10-23 Task 4 完成：提示词助手节点（5 种模式、流式、可取消）；宿主 onDelta 实为累计文本，插件按累计覆盖；仅有图时发兜底提示词；浏览器验收并入 Task 10。
- 2026-10-23 Task 5 完成：列表批量节点（变量组合、并发 3、单条重试、取消）；设置存 batchModel/batchSize/batchCount 以免与宿主生成设置冲突；浏览器验收并入 Task 10。
- 2026-10-23 Task 6 完成：宫格节点（4 个预设、生成大图后 canvas 切分铺图）；尺寸下拉为插件内置固定选项；浏览器验收并入 Task 10。
- 2026-10-23 Task 7 完成：分镜脚本节点（拆分镜 JSON、可编辑表格、批量出图/出视频）；hidePanel、出视频也并发 3、勾选不持久化；浏览器验收并入 Task 10。
- 2026-10-23 Task 8 完成：主体节点（1–4 张参考图、多图资源 urls、描述可拼入提示词、插件存储主体库）；浏览器验收并入 Task 10。
- 2026-10-23 Task 9 完成：工作流模板节点（捕获组、去运行态、偏移重建、插件存储模板库）；保存时 blob: 图片转 data URL 并去掉 storageKey；未改宿主；浏览器验收并入 Task 10。
- 2026-10-23 Task 10 完成：registry 清单 13 个插件，本地 web/public/plugins 自动发现 13 个；web typecheck 通过、bun test 26 pass；浏览器里 8 个插件逐个启停均正确；修复参考栏不展开插件多图资源的问题（27ec757）。

## 验收记录（spec 验收标准 1–11）

- 1 通过：registry 构建 13 个插件，清单含 8 个新插件；本地开发自动发现，默认停用。
- 2 通过：8 个插件逐个启用后出现在「扩展节点」菜单，停用后消失，无页面异常。开发模式控制台有 React「key」警告，只启用 markdown、便利贴时同样出现，来自 SDK jsx 运行时对静态多子节点的处理，属既有问题，生产构建不输出。
- 3 部分通过：2×3 变量显示「将生成 9 张」；未在真实生成下验收（未配置模型 Key）。
- 4 未在真实生成下验收（未配置模型 Key）。
- 5 通过：4 张图、2 列导出得到「拼图 4 张」图片节点，2064×2576 与布局计算一致，位于节点右侧 80px 并连线，刷新后仍显示。
- 6 通过：滑块拖动 50%→20%，切换并排后 compareMode 存为 side。
- 7 未在真实生成下验收（未配置模型 Key）。
- 8 部分通过：分镜表可显示、编辑、增删行；拆分镜、批量出图、出视频未在真实生成下验收（未配置模型 Key）。
- 9 通过（未发真实请求）：2 张图主体存库，在另一画布载入，连到图片节点后参考栏显示图1、图2，生成上下文 referenceImages 为 2 张。
- 10 通过：3 节点 2 连线的组存为模板，插入后新组在模板节点右侧 80px，3 个成员相对偏移与连线一致。
- 11 通过：markdown、便利贴抽查渲染正常；web typecheck 通过，bun test 26 pass。
