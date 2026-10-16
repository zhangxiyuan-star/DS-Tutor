# 数据结构陪学 Agent（DSTutor）

面向《数据结构》课程的听课陪学桌面应用：答疑 + C/Python 代码实操 + 结构动画可视化。
形态为 Windows 单机 exe（pywebview 壳 + 内置 HTTP 服务 + 纯前端 UI），适配一切 OpenAI 兼容 LLM API。

## 功能概览

- **答疑对话**：苏格拉底引导 / 直接讲解 / 考点向 三种教学风格，流式输出，Markdown 渲染
- **代码实操**：Monaco 编辑器（C/Python 双缓冲），Python 走 Pyodide 浏览器内运行，C 优先本机 gcc、无编译器时走 Wandbox 云端
- **结构动画（V2）**：LLM 调用 `visualize` 工具，前端按真实算法逐帧计算并渲染 SVG 动画，卡片内嵌聊天流，支持播放/暂停/单步/进度条/三档速度
- **随堂测验（V3）**：LLM 调用 `quiz` 工具出单选/填空/编程题，前端渲染可作答卡片并自动判题（编程题走沙箱比对 stdout），答错可一键请求 Agent 讲解
- **学习进度（V3）**：按知识点记录作答对错，localStorage 持久化；进度面板展示累计统计与薄弱点（作答 ≥2 次且正确率 <60%），可一键针对薄弱点出题；学习档案摘要自动注入系统提示词
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

### V3（2026-10-16）随堂测验 + 学习进度 ✅

- 新增 `quiz` 工具（choice/fill/code 三题型）与提示词约定；无 function calling 模型走 ` ```quiz ` JSON 围栏块兼容模式
- 新增 `web/js/progress.js`：按知识点记录对错、识别薄弱点（≥2 次作答且正确率 <60%）、生成系统提示词注入用的学习档案摘要，localStorage 持久化
- 聊天流嵌入可作答测验卡片：单选/填空即时判题（填空忽略大小写与首尾空白、支持 `|` 分隔等价答案），编程题沙箱运行比对 stdout（忽略行尾空白）；一题一次作答，答错显示"让 Agent 讲解这道题"
- 顶栏新增「▤ 学习进度」面板：累计统计、按知识点明细、薄弱点列表，支持"针对薄弱点出题"与清空记录
- 验证：mock LLM 全链路冒烟通过——三题型渲染、答对/答错判题、进度统计与薄弱点识别、薄弱点定向出题、档案注入系统提示词、围栏兼容模式，浏览器实测均通过，无 JS 报错

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
    └── js/  config.js / llm.js / prompts.js / progress.js / sandbox.js / visualizer.js / agent.js / app.js
```
