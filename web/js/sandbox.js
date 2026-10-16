/* 代码沙箱：Python(Pyodide 浏览器内) + C(本地 gcc / Piston 云端) + Monaco 编辑器 */
(function () {
  let pyodide = null;
  let pyLoading = null;
  const pyStatusListeners = [];

  function emitPyStatus(s) { pyStatusListeners.forEach((fn) => fn(s)); }

  // 懒加载 Pyodide
  async function ensurePyodide() {
    if (pyodide) return pyodide;
    if (pyLoading) return pyLoading;
    pyLoading = (async () => {
      emitPyStatus("loading");
      pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
      // 教学代码若调用 input()，给出明确提示而非静默卡死
      pyodide.runPython(`
import builtins as _b
def _input_disabled(prompt=""):
    raise RuntimeError("暂不支持运行时输入(input)，请把数据直接写在代码里")
_b.input = _input_disabled
`);
      emitPyStatus("ready");
      return pyodide;
    })();
    try {
      return await pyLoading;
    } catch (e) {
      pyLoading = null;
      emitPyStatus("error");
      throw e;
    }
  }

  async function runPython(code) {
    let py;
    try {
      py = await ensurePyodide();
    } catch (e) {
      // Pyodide 加载失败（无网络）→ 回退到后端本地 Python
      return runPythonLocal(code, "Pyodide 加载失败，已改用本地 Python：" + e.message);
    }

    var buf = "", errBuf = "";
    py.setStdout({ batched: (s) => { buf += s + "\n"; } });
    py.setStderr({ batched: (s) => { errBuf += s + "\n"; } });
    try {
      await py.runPythonAsync(code);
      return { ok: true, stdout: buf, stderr: errBuf, runner: "Pyodide 浏览器沙箱" };
    } catch (e) {
      // Pyodide 的异常消息较长，取最后几行关键信息
      const msg = String(e.message || e).split("\n").slice(-6).join("\n");
      return { ok: false, stage: "run", error: msg, stdout: buf, runner: "Pyodide 浏览器沙箱" };
    }
  }

  async function runPythonLocal(code, note) {
    try {
      const resp = await fetch("/__api__/run_python", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const r = await resp.json();
      if (note && r.ok) r.note = note;
      return r;
    } catch (e) {
      return { ok: false, stage: "network", error: (note ? note + "\n" : "") + "本地 Python 也不可用：" + e.message };
    }
  }

  async function runC(code) {
    try {
      const resp = await fetch("/__api__/run_c", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, allow_cloud: true }),
      });
      return await resp.json();
    } catch (e) {
      return { ok: false, stage: "network", error: "请求本地运行服务失败：" + e.message };
    }
  }

  async function runCode(language, code) {
    if (language === "python") return runPython(code);
    return runC(code);
  }

  async function detectEnv() {
    try {
      const r = await fetch("/__api__/env");
      return await r.json();
    } catch {
      return { compiler: null };
    }
  }

  // ---------------- Monaco 编辑器 ----------------
  let editor = null;
  let models = {};
  let currentLang = "c";

  const STARTER = {
    c: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    // 在这里写你的 C 代码，点右上角「运行」
    int a[] = {3, 1, 4, 1, 5, 9, 2, 6};
    int n = sizeof(a) / sizeof(a[0]);
    for (int i = 0; i < n; i++) {
        printf("%d ", a[i]);
    }
    printf("\\n");
    return 0;
}
`,
    python: `# 在这里写你的 Python 代码，点右上角「运行」
a = [3, 1, 4, 1, 5, 9, 2, 6]
for x in a:
    print(x, end=" ")
print()
`,
  };

  function initEditor(onReady) {
    require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" } });
    require(["vs/editor/editor.main"], function () {
      monaco.editor.defineTheme("inkboard", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "7d8f88", fontStyle: "italic" },
          { token: "keyword", foreground: "c98f5a" },
          { token: "number", foreground: "d4a84a" },
          { token: "string", foreground: "9bbf7d" },
        ],
        colors: {
          "editor.background": "#18160f",
          "editor.foreground": "#e8e2d2",
          "editorLineNumber.foreground": "#5a5548",
          "editor.lineHighlightBackground": "#201d16",
          "editorCursor.foreground": "#c9a35a",
          "editor.selectionBackground": "#3a4a42",
        },
      });
      // 两种语言各自独立缓冲区，切换 tab 不丢代码
      models.c = monaco.editor.createModel(STARTER.c, "c");
      models.python = monaco.editor.createModel(STARTER.python, "python");
      editor = monaco.editor.create(document.querySelector(".editor-wrap"), {
        model: models.c,
        theme: "inkboard",
        fontSize: 13.5,
        fontFamily: '"JetBrains Mono", Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        padding: { top: 10 },
      });
      onReady?.(editor);
    });
  }

  function setLanguage(lang) {
    currentLang = lang;
    if (!editor || !models[lang]) return;
    editor.setModel(models[lang]);
  }

  function getCode() { return editor ? editor.getValue() : ""; }
  function setCode(code, lang) {
    if (!editor) return;
    if (lang && lang !== currentLang) {
      currentLang = lang;
      editor.setModel(models[lang]);
    }
    editor.setValue(code);
  }

  window.Sandbox = {
    runCode,
    detectEnv,
    initEditor,
    setLanguage,
    getCode,
    setCode,
    ensurePyodide,
    onPyStatus: (fn) => pyStatusListeners.push(fn),
    get lang() { return currentLang; },
  };
})();
