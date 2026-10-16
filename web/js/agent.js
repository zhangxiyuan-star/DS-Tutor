/* Agent 核心：系统提示词、多轮工具调用循环、Markdown 渲染 */
(function () {
  let history = []; // OpenAI 格式对话历史
  const MAX_TOOL_ROUNDS = 6;

  function reset() { history = []; }

  function buildSystem(cfg) {
    let sys = PROMPTS.base + (PROMPTS.styles[cfg.style] || PROMPTS.styles.guide);
    if (!cfg.tools) sys += PROMPTS.noTools;
    sys += window.Progress?.promptBrief?.() || "";
    return sys;
  }

  /** 校验 quiz 题卡参数，合法返回 null，否则返回错误说明 */
  function validateQuiz(q) {
    if (!q || typeof q !== "object") return "quiz 参数必须是对象";
    if (!["choice", "fill", "code"].includes(q.kind)) return "kind 必须是 choice / fill / code";
    if (!q.topic || !String(q.topic).trim()) return "缺少 topic 知识点标签";
    if (!q.question || !String(q.question).trim()) return "缺少 question 题干";
    if (q.kind === "choice") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 5)
        return "choice 题需要 2~5 个 options";
      if (typeof q.answer !== "number" || q.answer < 0 || q.answer >= q.options.length)
        return "choice 题 answer 必须是正确选项下标（从 0 开始的数字）";
    } else if (q.kind === "fill") {
      if (typeof q.answer !== "string" || !q.answer.trim())
        return "fill 题 answer 必须是非空字符串（多个等价答案用 | 分隔）";
    } else {
      if (!["c", "python"].includes(q.language)) return "code 题需要 language: c / python";
      if (typeof q.answer !== "string") return "code 题 answer 必须是期望的标准输出字符串";
    }
    if (!q.explanation || !String(q.explanation).trim()) return "缺少 explanation 解析";
    return null;
  }

  /**
   * 运行一轮对话（含工具循环）
   * @param {string} userText
   * @param {object} cfg
   * @param {object} ui 回调集合
   */
  async function run(userText, cfg, ui) {
    history.push({ role: "user", content: userText });

    const useTools = !!cfg.tools;
    let guard = 0;

    while (guard++ < MAX_TOOL_ROUNDS) {
      const messages = [{ role: "system", content: buildSystem(cfg) }, ...history];

      ui.beforeTurn?.();
      const assistant = await LLM.chatStream(
        cfg, messages, useTools ? TOOLS : null,
        {
          onDelta: (text) => ui.onStream?.(text),
          onTool: () => {},
          onError: (e) => ui.onError?.(e),
        }
      );

      history.push(assistant);

      // 没有工具调用 → 对话回合结束，渲染最终回复
      const calls = assistant.tool_calls || [];
      if (!calls.length) {
        ui.onFinal?.(assistant.content || "（无回复）");
        return;
      }

      // 先把模型的解说落盘（可能为空），再执行工具
      if (assistant.content) ui.onFinal?.(assistant.content, { partial: true });

      for (const call of calls) {
        const toolName = call.function?.name || "run_code";
        let args;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        let toolContent;

        if (toolName === "visualize") {
          ui.onVisualizeStart?.();
          // 本地生成动画（真实算法计算，保证正确）
          const result = Visualizer.create(args);
          ui.onVisualize?.(args, result);
          toolContent = JSON.stringify(result.ok
            ? { ok: true, title: result.title, frames: result.frames.length, summary: result.summary }
            : { ok: false, error: result.error });
        } else if (toolName === "quiz") {
          const qErr = validateQuiz(args);
          if (qErr) {
            toolContent = JSON.stringify({ ok: false, error: qErr });
          } else {
            ui.onQuizStart?.();
            ui.onQuiz?.(args);
            toolContent = JSON.stringify({
              ok: true,
              note: "题卡已展示给学生，学生在页面作答，系统自动判题并记录学习档案。你无需等待结果，也不要透露答案，用一句过渡语收尾即可。",
            });
          }
        } else {
          // 默认按 run_code 处理
          const language = args.language === "c" ? "c" : "python";
          const code = args.code || "";
          ui.onToolStart?.(language, code);
          const result = await Sandbox.runCode(language, code);
          ui.onToolResult?.(language, code, result);
          toolContent = JSON.stringify({
            ok: result.ok,
            stdout: result.stdout || "",
            stderr: result.error || result.stderr || "",
            stage: result.stage || null,
          });
        }

        history.push({
          role: "tool",
          tool_call_id: call.id,
          name: toolName,
          content: toolContent,
        });
      }
      // 工具结果入历史后继续循环，让模型解读结果
    }

    ui.onFinal?.("（已达到最大工具调用轮数，请换个问法或继续提问）");
  }

  // ---------------- Markdown 渲染 ----------------
  marked.setOptions({ breaks: false, gfm: true });

  /**
   * 渲染助手文本为 HTML，同时返回其中代码块/可视化块/测验块信息
   * @returns {{html: string, blocks: Array, visBlocks: Array, quizBlocks: Array}}
   * blocks: {lang:'c'|'python', code, autoRun, elId}
   * visBlocks: {elId, spec}
   * quizBlocks: {elId, spec}
   */
  function renderMarkdown(text) {
    const blocks = [];
    const visBlocks = [];
    const quizBlocks = [];
    const rawHtml = marked.parse(text || "");
    const clean = DOMPurify.sanitize(rawHtml);

    const host = document.createElement("div");
    host.innerHTML = clean;

    host.querySelectorAll("pre > code").forEach((codeEl) => {
      const cls = codeEl.className || "";
      const m = cls.match(/language-([\w-]+)/);
      const rawLang = m ? m[1].toLowerCase() : "";
      const code = codeEl.textContent;

      // visualize JSON 块 → 动画挂载占位
      if (rawLang === "visualize") {
        const elId = "vis-" + Math.random().toString(36).slice(2, 9);
        let spec = null;
        try { spec = JSON.parse(code); } catch { spec = { __parseError: code }; }
        const mount = document.createElement("div");
        mount.className = "vis-mount";
        mount.id = elId;
        codeEl.parentNode.replaceWith(mount);
        visBlocks.push({ elId, spec });
        return;
      }

      // quiz JSON 块 → 测验题卡挂载占位
      if (rawLang === "quiz") {
        const elId = "quiz-" + Math.random().toString(36).slice(2, 9);
        let spec = null;
        try { spec = JSON.parse(code); } catch { spec = { __parseError: code }; }
        const mount = document.createElement("div");
        mount.className = "quiz-mount";
        mount.id = elId;
        codeEl.parentNode.replaceWith(mount);
        quizBlocks.push({ elId, spec });
        return;
      }

      let lang = null;
      let autoRun = false;
      if (rawLang === "c" || rawLang === "cpp") lang = "c";
      else if (rawLang === "python" || rawLang === "py") lang = "python";
      else if (rawLang === "run-c") { lang = "c"; autoRun = true; }
      else if (rawLang === "run-python" || rawLang === "run-py") { lang = "python"; autoRun = true; }

      const card = document.createElement("div");
      card.className = "code-card";

      const head = document.createElement("div");
      head.className = "code-card-head";
      head.innerHTML = lang
        ? `<span class="lang-tag lang-${lang}">${lang === "c" ? "C" : "Python"}</span>`
        : `<span class="lang-tag">${rawLang || "code"}</span>`;

      const spacer = document.createElement("span");
      spacer.className = "spacer";
      head.appendChild(spacer);

      const preWrap = document.createElement("pre");
      preWrap.textContent = code;

      if (lang) {
        const elId = "cb-" + Math.random().toString(36).slice(2, 9);
        card.id = elId;

        const btnOpen = document.createElement("button");
        btnOpen.textContent = "↧ 工作台打开";
        btnOpen.onclick = () => window.App?.openInWorkbench(lang, code);
        const btnRun = document.createElement("button");
        btnRun.textContent = "▶ 运行";
        btnRun.onclick = () => window.App?.runCard(elId, lang, code, btnRun);
        head.appendChild(btnOpen);
        head.appendChild(btnRun);

        blocks.push({ lang, code, autoRun, elId });
      }

      card.appendChild(head);
      card.appendChild(preWrap);
      codeEl.parentNode.replaceWith(card);
    });

    return { html: host.innerHTML, blocks, visBlocks, quizBlocks };
  }

  /** 在代码卡片内追加运行结果 */
  function attachCardResult(elId, result) {
    const card = document.getElementById(elId);
    if (!card) return;
    card.querySelector(".code-result")?.remove();
    const div = document.createElement("div");
    const ok = result.ok;
    div.className = "code-result " + (ok ? "ok" : "err");
    let body = "";
    if (ok) {
      body = result.stdout
        ? "标准输出：\n" + escapeHtml(result.stdout)
        : "（程序无输出）";
      if (result.stderr) body += "\n[stderr]\n" + escapeHtml(result.stderr);
      body += `\n退出码 ${result.code ?? 0} · ${result.runner || ""}`;
    } else {
      const stageText = { compile: "编译错误", run: "运行错误", env: "环境问题", network: "网络问题" }[result.stage] || "错误";
      body = `✗ ${stageText}\n` + escapeHtml(result.error || result.stderr || "未知错误");
      if (result.stdout) body += "\n" + escapeHtml(result.stdout);
    }
    div.textContent = body;
    card.appendChild(div);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  window.Agent = { run, reset, renderMarkdown, attachCardResult, validateQuiz };
})();
