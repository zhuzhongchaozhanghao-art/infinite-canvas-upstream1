/**
 * APIMart MiniMax-H3-Max 视频：参考图先传 /v1/uploads/images 换公网链接，
 * 再 POST /v1/videos/generations 提交，轮询 GET /v1/tasks/{id}。
 * 1-2 张图按首尾帧，更多图或「参考」模式按参考图；参考视频/音频需公网链接，暂不支持。
 */
async function generateVideo({ prompt, images, videos, audios, params: { mode, seconds, resolution, ratio, watermark }, model, http, request, poll }) {
  if (videos.length || audios.length) throw new Error("APIMart 视频暂不支持参考视频/音频（需公网链接）");

  const upload = async (dataUrl) => {
    const blob = await (await fetch(dataUrl)).blob();
    const form = new FormData();
    form.append("file", blob, `ref.${(blob.type.split("/")[1] || "png").replace("jpeg", "jpg")}`);
    const res = await http.post("/uploads/images", form);
    if (!res?.url) throw new Error(`参考图上传失败：${JSON.stringify(res)}`);
    return res.url;
  };
  const urls = await Promise.all(images.map(upload));

  // 项目里的 480p/720p/1080p 对应 MiniMax 的 480P/768P/1080P
  const tier = { "480p": "480P", "1080p": "1080P" }[String(resolution).toLowerCase()] || "768P";
  const body = {
    model,
    prompt,
    duration: Math.min(15, Math.max(5, Math.round(Number(seconds) || 5))),
    resolution: tier,
  };
  if (ratio && ratio !== "auto") body.aspect_ratio = ratio;
  // 1080P 不能带 watermark 字段
  if (tier !== "1080P") body.watermark = Boolean(watermark);
  if (urls.length && (mode === "reference" || urls.length > 2)) body.image_urls = urls;
  else if (urls.length) {
    body.first_frame_image = urls[0];
    if (urls[1]) body.last_frame_image = urls[1];
  }

  const created = await http.post("/videos/generations", body);
  const taskId = created?.data?.[0]?.task_id || created?.data?.task_id;
  if (!taskId) throw new Error(`APIMart 未返回任务 ID：${JSON.stringify(created)}`);

  const task = await poll(
    () => http.get(`/tasks/${taskId}`, { params: { language: "zh" } }),
    (res) => {
      const data = res?.data;
      if (data?.status === "failed" || data?.status === "cancelled") throw new Error(data?.error?.message || `任务${data.status}`);
      return data?.status === "completed" ? data : null;
    },
    { intervalMs: 5000, timeoutMs: 1800000 },
  );

  const item = task.result?.videos?.[0];
  const url = Array.isArray(item?.url) ? item.url[0] : item?.url;
  if (!url) throw new Error(`APIMart 未返回视频：${JSON.stringify(task.result)}`);
  // 结果链接会过期，下载成 Blob 存本地；下载失败时退回链接
  try {
    return { blob: await request({ url, responseType: "blob" }) };
  } catch {
    return { url };
  }
}

return await generateVideo({ prompt, images, videos, audios, params, model, http, request, poll });
