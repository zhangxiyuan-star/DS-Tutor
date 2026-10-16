/* UI 总装：设置、消息渲染、工作台交互 */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let cfg = Config.load();
  let busy = false;

  // ---------------- DOM ----------------
  const messagesEl = $("#messages");
  const inputEl = $("#input");
  const btnSend = $("#btnSend");
  const modelStatus = $("#modelStatus");
  const consoleEl = $("#console");
  const runnerInfo = $("#runnerInfo");

  // ---------------- 工具函数 ----------------
  function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function removeWelcome() {
    messagesEl.querySelector(".welcome")?.remove();
  }

  function addUserMsg(text) {
    removeWelcome();
    const div = document.createElement("div");
    div.className = "msg msg-user";
    div.innerHTML = `<div class="bubble"></div>`;
    div.querySelector(".bubble").textContent = text;
    messagesEl.appendChild(div);
    scrollDown();
  }

  // 活动助手段管理
  let current = null;

  function newAssistantSeg() {
    const wrap = document.createElement("div");
    wrap.className = "msg msg-assistant";
    wrap.innerHTML = `<div class="who">AGENT</div><div class="msg-body typing-dot"></div>`;
    messagesEl.appendChild(wrap);
    current = { el: wrap, body: wrap.querySelector(".msg-body"), text: "", done: false };
    scrollDown();
    return current;
  }

  function finalizeSeg() {
    if (!current) return null;
    const seg = current;
    seg.done = true;
    seg.body.classList.remove("typing-dot");
    const { html, blocks, visBlocks } = Agent.renderMarkdown(seg.text);
    seg.body.innerHTML = html;
    current = null;
    scrollDown();
    // 兼容模式：自动执行 run-python / run-c 块
    blocks.filter((b) => b.autoRun).forEach((b) => runCard(b.elId, b.lang, b.code));
    // 兼容模式：visualize JSON 块自动渲染为动画
    visBlocks.forEach((b) => mountVis(b.elId, b.spec));
    return seg;
  }

  // 挂载可视化动画（两种入口共用）
  function mountVis(elIdOrEl, spec) {
    const host = typeof elIdOrEl === "string" ? document.getElementById(elIdOrEl) : elIdOrEl;
    if (!host) return;
    if (!spec || "__parseError" in spec) {
      host.innerHTML = `<div class="vis-card">
        <div class="vis-head"><span class="vis-title vis-err">动画参数解析失败</span></div>
        <div class="vis-error">visualize 代码块必须是严格合法的 JSON，不能有注释或多余逗号。</div></div>`;
      return;
    }
    Visualizer.mount(host, spec);
  }

  function addVisCard(spec) {
    const wrap = document.createElement("div");
    wrap.className = "msg";
    wrap.innerHTML = `<div class="tool-note vis-note">◆ 结构动画（可单步播放、拖动进度条回看）</div><div class="vis-mount"></div>`;
    messagesEl.appendChild(wrap);
    mountVis(wrap.querySelector(".vis-mount"), spec);
    scrollDown();
    return wrap;
  }

  function addToolCard(language, code) {
    const wrap = document.createElement("div");
    wrap.className = "msg";
    wrap.innerHTML = `
      <div class="tool-note"><span class="spin"></span>Agent 正在运行 ${language === "c" ? "C" : "Python"} 代码…</div>
      <div class="code-card">
        <div class="code-card-head">
          <span class="lang-tag lang-${language}">${language === "c" ? "C" : "Python"}</span>
          <span class="spacer"></span>
          <button class="t-open">↧ 工作台打开</button>
        </div>
        <pre></pre>
      </div>`;
    wrap.querySelector("pre").textContent = code;
    wrap.querySelector(".t-open").onclick = () => openInWorkbench(language, code);
    messagesEl.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function finishToolCard(card, language, result) {
    const note = card.querySelector(".tool-note");
    note.classList.remove("spin");
    note.innerHTML = result.ok
           ? `✓ Agent 运行完成（${result.runner || ""}）`
      : `✗ 运行失败：${({ compile: "编译错误", run: "运行错误", env: "无编译器", network: "网络问题" })[result.stage] || "错误"}（已交回 Agent 分析）`;

    const div = document.createElement("div");
    div.className = "code-result " + (result.ok ? "ok" : "err");
    if (result.ok) {
      div.textContent = (result.stdout ? "标准输出：\n" + result.stdout : "（程序无输出）")
        + (result.stderr ? "\n[stderr]\n" + result.stderr : "")
        + `\n退出码 ${result.code ?? 0}`;
    } else {
      div.textContent = "✗ " + (result.error || result.stderr || "未知错误")
        + (result.stdout ? "\n" + result.stdout : "");
    }
    card.querySelector(".code-card").appendChild(div);
    scrollDown();
  }

  // ---------------- 发送 ----------------
  async function send(text) {
    text = (text ?? inputEl.value).trim();
    if (!text || busy) return;

    if (!cfg.base_url || !cfg.model) {
      openSettings();
      alertFn("请先在「设置」中配置 API 地址和模型名");
      return;
    }

    busy = true;
    btnSend.disabled = true;
    addUserMsg(text);
    inputEl.value = "";
    autoGrow();

    const ui = {
      beforeTurn() {
        if (!current || current.done) newAssistantSeg();
      },
      onStream(t) {
        if (!current) newAssistantSeg();
        current.text = t;
        current.body.textContent = t;
        scrollDown();
      },
      onFinal(content, opts) {
        if (current) {
          current.text = content || current.text;
          finalizeSeg();
        } else if (content) {
          // 工具轮次后的新一轮解说
          const seg = newAssistantSeg();
          seg.text = content;
          finalizeSeg();
        }
      },
      onToolStart(language, code) {
        if (current && current.text.trim()) finalizeSeg();
        else if (current) { current.body.classList.remove("typing-dot"); current = null; }
        ui._toolCard = addToolCard(language, code);
      },
      onToolResult(language, code, result) {
        finishToolCard(ui._toolCard, language, result);
      },
      onVisualizeStart() {
        if (current && current.text.trim()) finalizeSeg();
        else if (current) { current.body.classList.remove("typing-dot"); current = null; }
      },
      onVisualize(spec) {
        addVisCard(spec);
      },
      onError(msg) {
        if (current) {
          current.done = true;
          current.body.classList.remove("typing-dot");
          if (!current.text.trim()) {
            current.body.innerHTML = `<span style="color:var(--ochre)">⚠ ${escapeHtml(msg)}</span>`;
          }
          current = null;
        } else {
          const seg = newAssistantSeg();
          seg.body.innerHTML = `<span style="color:var(--ochre)">⚠ ${escapeHtml(msg)}</span>`;
          seg.done = true;
          current = null;
        }
      },
    };

    try {
      await Agent.run(text, cfg, ui);
    } catch (e) {
      ui.onError?.(e.message || String(e));
    } finally {
      busy = false;
      btnSend.disabled = false;
      inputEl.focus();
    }
  }

  function alertFn(msg) {
    const seg = newAssistantSeg();
    seg.body.style.color = "var(--ochre)";
    seg.body.textContent = "⚠ " + msg;
    seg.done = true;
    current = null;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // ---------------- 代码卡片/工作台 ----------------
  async function runCard(elId, language, code, btn) {
    Agent.attachCardResult(elId, { ok: false, stage: "run", error: "运行中…" });
    // 上面先占位，下面真实结果覆盖
    const result = await Sandbox.runCode(language, code);
    Agent.attachCardResult(elId, result);
  }

  function openInWorkbench(language, code) {
    $$(".wb-tab").forEach((t) => t.classList.toggle("active", t.dataset.lang === language));
    Sandbox.setLanguage(language);
    Sandbox.setCode(code, language);
  }

  // ---------------- 控制台 ----------------
  function con(text, cls) {
    const span = document.createElement("div");
    if (cls) span.className = cls;
    span.textContent = text;
    consoleEl.appendChild(span);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  async function runWorkbench() {
    const btn = $("#btnRun");
    const lang = Sandbox.lang;
    const code = Sandbox.getCode();
    btn.disabled = true;
    con(`── ▶ 运行 ${lang === "c" ? "C" : "Python"}  ${new Date().toLocaleTimeString()} ──`, "con-system");
    const result = await Sandbox.runCode(lang, code);
    if (result.ok) {
      con(result.stdout || "（程序无输出）", "con-ok");
      if (result.stderr) con(result.stderr);
      con(`[退出码 ${result.code ?? 0} · ${result.runner || ""}]`, "con-system");
    } else {
      const stageText = { compile: "编译错误", run: "运行错误", env: "环境问题", network: "网络问题" }[result.stage] || "错误";
      con(`✗ ${stageText}`, "con-err");
      con(result.error || result.stderr || "未知错误", "con-err");
      if (result.stdout) con(result.stdout);
      if (result.stage === "env") con("提示：C 编译器缺失时已自动尝试 Piston 云端；若仍失败可安装 gcc/MinGW 或 TDM-GCC。", "con-system");
    }
    btn.disabled = false;
  }

  // ---------------- 设置弹窗 ----------------
  const mask = $("#settingsMask");
  function openSettings() {
    fillSettings();
    mask.classList.remove("hidden");
  }
  function closeSettings() { mask.classList.add("hidden"); }

  function fillSettings() {
    $("#cfgPreset").innerHTML = Object.entries(Config.PRESETS)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    $("#cfgPreset").value = cfg.preset || "custom";
    $("#cfgBaseUrl").value = cfg.base_url || "";
    $("#cfgApiKey").value = cfg.api_key || "";
    $("#cfgModel").value = cfg.model || "";
    $("#cfgTemp").value = cfg.temperature ?? 0.5;
    $("#cfgTools").checked = !!cfg.tools;
    $("#cfgStyle").value = cfg.style || "guide";
    $("#testResult").textContent = "";
    $("#testResult").className = "test-result";
  }

  function onPresetChange() {
    const p = Config.PRESETS[$("#cfgPreset").value];
    if (!p) return;
    if (p.base_url) $("#cfgBaseUrl").value = p.base_url;
    if (p.model) $("#cfgModel").value = p.model;
    $("#cfgTools").checked = p.tools;
  }

  function saveSettings() {
    cfg = {
      preset: $("#cfgPreset").value,
      base_url: $("#cfgBaseUrl").value.trim().replace(/\/+$/, ""),
      api_key: $("#cfgApiKey").value.trim(),
      model: $("#cfgModel").value.trim(),
      temperature: parseFloat($("#cfgTemp").value) || 0.5,
      tools: $("#cfgTools").checked,
      style: $("#cfgStyle").value,
    };
    Config.save(cfg);
    updateStatus();
    closeSettings();
  }

  async function testApi() {
    const testCfg = {
      base_url: $("#cfgBaseUrl").value.trim().replace(/\/+$/, ""),
      api_key: $("#cfgApiKey").value.trim(),
      model: $("#cfgModel").value.trim(),
    };
    const out = $("#testResult");
    out.className = "test-result";
    out.textContent = "测试中…";
    try {
      const data = await LLM.test(testCfg);
      const content = data.choices?.[0]?.message?.content;
      out.className = "test-result ok";
      out.textContent = "✓ 连接成功" + (content ? "，模型有响应" : "");
    } catch (e) {
      out.className = "test-result fail";
      out.textContent = "✗ " + e.message;
    }
  }

  function updateStatus() {
    if (cfg.base_url && cfg.model) {
      modelStatus.textContent = `${Config.PRESETS[cfg.preset]?.label || "自定义"} · ${cfg.model}`;
      modelStatus.style.color = "var(--pine)";
    } else {
      modelStatus.textContent = "未配置模型";
      modelStatus.style.color = "var(--ochre)";
    }
  }

  // ---------------- 输入框自适应 ----------------
  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
  }

  // ---------------- 事件绑定 ----------------
  function bind() {
    btnSend.onclick = () => send();
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    inputEl.addEventListener("input", autoGrow);

    $("#btnSettings").onclick = openSettings;
    $("#btnCloseSettings").onclick = closeSettings;
    $("#btnSaveSettings").onclick = saveSettings;
    $("#btnTestApi").onclick = testApi;
    $("#cfgPreset").onchange = onPresetChange;
    mask.addEventListener("click", (e) => { if (e.target === mask) closeSettings(); });

    $("#btnClear").onclick = () => {
      if (busy) return;
      Agent.reset();
      messagesEl.innerHTML = "";
      messagesEl.appendChild(makeWelcome());
      bindChips();
    };

    $$(".wb-tab").forEach((t) => {
      t.onclick = () => {
        $$(".wb-tab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        Sandbox.setLanguage(t.dataset.lang);
      };
    });
    $("#btnRun").onclick = runWorkbench;
    $("#btnClearConsole").onclick = () => { consoleEl.innerHTML = ""; };

    bindChips();
  }

  function bindChips() {
    $$(".chip").forEach((c) => { c.onclick = () => send(c.dataset.q); });
  }

  function makeWelcome() {
    // 清空后重建欢迎区（从现有 HTML 模板不方便取，直接构造）
    const div = document.createElement("div");
    div.className = "welcome";
    div.innerHTML = `
      <h1>今天学什么数据结构？</h1>
      <p>我可以讲解概念、对比易混点、推演复杂度，也可以直接写 C / Python 代码带你跑。</p>
      <div class="suggestion-row">
        <button class="chip" data-q="用生活中的例子讲清楚栈和队列的区别">栈和队列的区别</button>
        <button class="chip" data-q="带我从零实现单链表（C 语言）">实现单链表（C）</button>
        <button class="chip" data-q="递归我总搞不懂，能循序渐进教我吗？">递归入门</button>
        <button class="chip" data-q="快速排序为什么平均是 O(nlogn)？最坏情况呢？">快排复杂度</button>
        <button class="chip" data-q="二叉树的前中后序遍历，Python 实现">二叉树遍历（Python）</button>
        <button class="chip" data-q="哈希表是怎么解决冲突的？">哈希冲突</button>
      </div>
      <p class="hint">先点「⚙ 设置」填好 API，即可开始对话</p>`;
    return div;
  }

  // ---------------- 启动 ----------------
  async function boot() {
    bind();
    updateStatus();

    Sandbox.initEditor();

    // 环境探测
    const env = await Sandbox.detectEnv();
    if (env.compiler) {
      runnerInfo.textContent = `C: 本地 ${env.compiler} · Python: Pyodide`;
    } else {
      runnerInfo.textContent = "C: 云端编译（无本地编译器）· Python: Pyodide";
    }
    Sandbox.onPyStatus((s) => {
      if (s === "loading") con("Python 运行环境（Pyodide）首次加载中，约 10MB…", "con-system");
      if (s === "ready") con("Python 环境就绪。", "con-system");
      if (s === "error") con("Pyodide 加载失败，请检查网络。", "con-err");
    });

    // 首次未配置 → 直接弹设置
    if (!cfg.base_url || !cfg.model) {
      setTimeout(openSettings, 400);
    }
  }

  window.App = { openInWorkbench, runCard };
  document.addEventListener("DOMContentLoaded", boot);
})();
