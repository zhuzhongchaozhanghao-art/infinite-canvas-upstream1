/**
 * APIMart 文本：POST /v1/chat/completions 流式输出（GLM 不支持 /v1/responses，统一走 chat/completions）。
 * 只输出正文，丢弃 reasoning_content 思考过程。
 */
async function chat({ messages, model, apiKey, http, signal, onDelta }) {
  const response = await fetch(http.url("/chat/completions"), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!response.ok) throw new Error(`APIMart ${response.status}：${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, "").trim();
      if (!line.startsWith("data:") || !data || data === "[DONE]") continue;
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }
  }
  return text;
}

return await chat({ messages, model, apiKey, http, signal, onDelta });
