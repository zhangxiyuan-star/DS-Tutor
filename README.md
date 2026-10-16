# 数据结构陪学 Agent（DSTutor）

面向《数据结构》课程的听课陪学桌面应用：答疑 + C/Python 代码实操 + 结构动画可视化。
形态为 Windows 单机 exe（pywebview 壳 + 内置 HTTP 服务 + 纯前端 UI），适配一切 OpenAI 兼容 LLM API。

## 功能概览

- **答疑对话**：苏格拉底引导 / 直接讲解 / 考点向 三种教学风格，流式输出，Markdown 渲染
- **代码实操**：Monaco 编辑器（C/Python 双缓冲），Python 走 Pyodide 浏览器内运行，C 优先本机 gcc、无编译器时走 Wandbox 云端
- **结构动画（V2）**：LLM 调用 `visualize` 工具，前端按真实算法逐帧计算并渲染 SVG 动画，卡片内嵌聊天流，支持播放/暂停/单步/进度条/三档速度
- **API 适配**：OpenAI 兼容协议，Python 后端代理消除 CORS；内置 DeepSeek / Kimi / 智谱 GLM / 通义千问 / OpenAI / Ollama / LM Studio / 自定义 8 组预设；无 function calling 的模型走围栏代码块兼容模式

## 可视化剧目（6 类）

| kind | 内容 |
|---|---|
| stack / queue | 出入栈、出入队分镜，top/front/rear 指针 |
| linked_list | 单链表插入/删除的指针变化分镜 |
| binary_tree | 层序数组建树，前/中/后/层序遍历逐帧点亮 |
| graph | 圆形布局，DFS/BFS 访问序列与遍历路径边 |
| sort | 冒泡/选择/插入/快排/归并，比较·交换·基准·有序标记 |

教学正确性设计：动画帧全部由前端内置算法计算，LLM 只传小例子参数（树/图 ≤7 结点、排序 ≤8 个数），工具返回正确结果序列供模型讲解，杜绝模型编造中间过程。

## 版本记录

### V2（2026-10-15）结构可视化动画 ✅

- 新增可视化引擎 `web/js/visualizer.js`：帧模型 + 6 类剧目生成器 + SVG 渲染器 + 播放器
- Agent 新增 `visualize` 工具定义与提示词约定，工具循环上限提至 6 轮
- 聊天流嵌入动画卡片；兼容模式识别 ` ```visualize ` JSON 围栏块
- 修复：`order.map(cap)` 索引透传陷阱（首元素被截成"…"，8 处）；builder 中文 kind 键导致渲染器查表失败（6 处）
- 验证：算法断言 **25/25** 通过；播放器交互浏览器实测通过；mock LLM 全链路冒烟（tool_call → 动画卡片 → 讲解序列一致）通过；exe 重打包验证通过

### V1（MVP）

- 聊天流式问答、8 组 API 预设、双路径工具调用（function calling / 兼容模式）
- C/Python 沙箱（Wandbox / Pyodide + 本地回退）、Monaco 双语言工作台
- PyInstaller 打包 exe 实测通过

### V3（规划）

Agent 出题 + 自动判题 + 学习进度 / 薄弱点记忆。

## 使用

1. `pip install -r requirements.txt`
2. 开发调试：`python app.py`（`DS_TUTOR_NO_WEBVIEW=1` + `DS_TUTOR_PORT=xxxx` 可纯浏览器调试）
3. 打包：运行 `build.bat`，产物在 `dist/DSTutor/DSTutor.exe`
4. 首次打开点「⚙ 设置」选预设、填 API Key 即可使用

## 目录结构

```
ds-tutor/
├── app.py            # pywebview 壳 + HTTP 服务（静态资源 + /__api__/ 代理与沙箱端点）
├── build.bat         # PyInstaller 打包脚本
├── requirements.txt
└── web/
    ├── index.html
    ├── css/style.css
    └── js/  config.js / llm.js / prompts.js / sandbox.js / visualizer.js / agent.js / app.js
```
