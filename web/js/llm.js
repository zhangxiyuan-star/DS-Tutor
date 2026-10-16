/* LLM 客户端：经本地 Python 代理请求，解析 SSE 流 */
(function () {
  /**
   * 流式对话
   * @param {object} cfg 配置（base_url/api_key/model/temperature）
   * @param {array} messages OpenAI 格式消息
   * @param {object} handlers { onDelta(accText), onTool(toolAcc), onDone(finalMsg), onError(err) }
   * @param {array|null} tools 工具定义；null 表示不带 tools
   * @returns {Promise<object>} 完整 assistant message
   */
  async function chatStream(cfg, messages, tools, handlers) {
    const body = {
      base_url: cfg.base_url,
      api_key: cfg.api_key,
      model: cfg.model,
      messages,
      temperature: cfg.temperature ?? 0.5,
      stream: true,
    };
    if (tools) body.tools = tools;

    let resp;
    try {
      resp = await fetch("/__api__/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      handlers.onError?.("网络请求失败：" + e.message);
      throw e;
    }

    if (!resp.ok || !resp.body) {
      let detail = "";
      try { detail = (await resp.json()).error?.message || ""; } catch {}
      const msg = `API 请求失败（${resp.status}）${detail ? "：" + detail : ""}`;
      handlers.onError?.(msg);
      throw new Error(msg);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // 累积的 assistant 消息
    const acc = { role: "assistant", content: "", tool_calls: [] };
    let gotError = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // 最后一行可能不完整

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;

        let json;
        try { json = JSON.parse(data); } catch { continue; }

        if (json.error) {
          gotError = json.error.message || JSON.stringify(json.error);
          continue;
        }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          acc.content += delta.content;
          handlers.onDelta?.(acc.content);
        }
        // 合并流式 tool_calls 分片
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!acc.tool_calls[idx]) {
              acc.tool_calls[idx] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
            }
            const slot = acc.tool_calls[idx];
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.function.name += tc.function.name;
            if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
            handlers.onTool?.(acc.tool_calls);
          }
        }
      }
    }

    if (gotError) {
      handlers.onError?.(gotError);
      throw new Error(gotError);
    }
    if (!acc.tool_calls.length) delete acc.tool_calls;
    handlers.onDone?.(acc);
    return acc;
  }

  /** 非流式测试连接 */
  async function test(cfg) {
    const body = {
      base_url: cfg.base_url,
      api_key: cfg.api_key,
      model: cfg.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 4,
      stream: false,
    };
    const resp = await fetch("/__api__/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!resp.ok || data.error) {
      throw new Error(data.error?.message || `HTTP ${resp.status}`);
    }
    return data;
  }

  window.LLM = { chatStream, test };
})();
