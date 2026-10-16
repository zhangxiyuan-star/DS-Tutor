/* 配置管理：API 预设 + localStorage 持久化 */
(function () {
  const KEY = "ds_tutor_config_v1";

  // 主流 OpenAI 兼容服务预设
  const PRESETS = {
    deepseek: {
      label: "DeepSeek",
      base_url: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      tools: true,
    },
    kimi: {
      label: "Kimi（月之暗面）",
      base_url: "https://api.moonshot.cn/v1",
      model: "moonshot-v1-8k",
      tools: true,
    },
    glm: {
      label: "智谱 GLM",
      base_url: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4-flash",
      tools: true,
    },
    qwen: {
      label: "通义千问（DashScope）",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      tools: true,
    },
    openai: {
      label: "OpenAI",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      tools: true,
    },
    ollama: {
      label: "Ollama（本地）",
      base_url: "http://localhost:11434/v1",
      model: "qwen2.5:7b",
      tools: false,
    },
    lmstudio: {
      label: "LM Studio（本地）",
      base_url: "http://localhost:1234/v1",
      model: "local-model",
      tools: false,
    },
    custom: {
      label: "自定义（OpenAI 兼容接口）",
      base_url: "",
      model: "",
      tools: true,
    },
  };

  const DEFAULT = {
    preset: "deepseek",
    base_url: PRESETS.deepseek.base_url,
    api_key: "",
    model: PRESETS.deepseek.model,
    temperature: 0.5,
    tools: true,
    style: "guide",
  };

  function load() {
    try {
      return Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem(KEY) || "{}"));
    } catch {
      return { ...DEFAULT };
    }
  }

  function save(cfg) {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  }

  window.Config = { load, save, PRESETS, DEFAULT };
})();
