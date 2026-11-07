/**
 * APIMart 异步生图：POST /v1/images/generations 提交任务，再轮询 GET /v1/tasks/{id}。
 * 适用 gemini-nano-banana-2.1 / gpt-image-2.5-flare / gpt-image-2.5-sunburst / flux-3-image。
 * 结果链接 24 小时过期，这里直接下载成 data URL 存进画布。
 */
async function generateImage({ prompt, images, params: { size, resolution, quality, count, background }, model, http, request, poll }) {
  // 像素尺寸换算成最接近的支持比例，APIMart 按「比例 + 档位」出图（Nano Banana 没有 9:21）
  const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", ...(model.startsWith("gemini") ? [] : ["9:21"])];
  const toRatio = (value) => {
    const match = /^(\d+)x(\d+)$/.exec(value || "");
    if (!match) return "auto";
    const target = Math.log(Number(match[1]) / Number(match[2]));
    const diff = (r) => Math.abs(Math.log(Number(r.split(":")[0]) / Number(r.split(":")[1])) - target);
    return ratios.reduce((best, r) => (diff(r) < diff(best) ? r : best));
  };
  const isGptImage = model.startsWith("gpt-image");
  const tier = /^[124]k$/i.test(resolution || "") ? resolution.toLowerCase() : "1k";
  const body = {
    model,
    prompt,
    n: count || 1,
    resolution: model.startsWith("gemini") ? tier.toUpperCase() : tier,
  };
  const ratio = toRatio(size);
  // 图生图不传比例时按参考图比例出图
  if (ratio !== "auto" || !images.length) body.size = ratio;
  if (images.length) body.image_urls = images;
  if (isGptImage && quality && quality !== "auto") body.quality = quality;
  if (isGptImage && background) body.background = background;

  const created = await http.post("/images/generations", body);
  const taskId = created?.data?.[0]?.task_id;
  if (!taskId) throw new Error(`APIMart 未返回任务 ID：${JSON.stringify(created)}`);

  const task = await poll(
    () => http.get(`/tasks/${taskId}`, { params: { language: "zh" } }),
    (res) => {
      const data = res?.data;
      if (data?.status === "failed" || data?.status === "cancelled") throw new Error(data?.error?.message || `任务${data.status}`);
      return data?.status === "completed" ? data : null;
    },
    { intervalMs: 3000, timeoutMs: 600000 },
  );

  const urls = (task.result?.images || []).flatMap((item) => (Array.isArray(item.url) ? item.url : [item.url])).filter(Boolean);
  const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  return Promise.all(urls.map(async (url) => toDataUrl(await request({ url, responseType: "blob" }))));
}

return await generateImage({ prompt, images, params, model, http, request, poll });
