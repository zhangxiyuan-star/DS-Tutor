# -*- coding: utf-8 -*-
"""
数据结构陪学 Agent —— 桌面端主程序
pywebview 开窗 + 内置 HTTP 服务（静态前端 / LLM 流式代理 / C 代码运行）
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import webview

# ---------------------------------------------------------------- 路径
def resource_path(rel):
    """兼容 PyInstaller 打包后的资源路径"""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)

WEB_DIR = resource_path("web")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

# ---------------------------------------------------------------- C 代码运行
def find_compiler():
    for name in ("gcc", "clang", "cc"):
        path = shutil.which(name)
        if path:
            return name
    return None

def run_c_local(code, timeout=10):
    compiler = find_compiler()
    if not compiler:
        return {"ok": False, "stage": "env", "error": "本机未检测到 C 编译器（gcc/clang）"}
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "main.c")
        out = os.path.join(d, "main.exe" if os.name == "nt" else "main")
        with open(src, "w", encoding="utf-8") as f:
            f.write(code)
        cp = subprocess.run(
            [compiler, src, "-o", out, "-std=c11"],
            capture_output=True, text=True, timeout=30,
        )
        if cp.returncode != 0:
            return {"ok": False, "stage": "compile", "error": cp.stderr}
        try:
            run = subprocess.run(
                [out], capture_output=True, text=True, timeout=timeout,
                input="",
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "stage": "run", "error": f"运行超时（>{timeout}s），可能存在死循环"}
        return {
            "ok": True,
            "stdout": run.stdout,
            "stderr": run.stderr,
            "code": run.returncode,
            "runner": "本地 " + compiler,
        }

# ---------------------------------------------------------------- Python 本地运行
def run_python_local(code, timeout=10):
    """用本机 Python 运行（Pyodide 加载失败时的兜底）"""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "main.py")
        with open(src, "w", encoding="utf-8") as f:
            f.write(code)
        try:
            run = subprocess.run(
                [sys.executable, src],
                capture_output=True, text=True, timeout=timeout,
                input="", encoding="utf-8", errors="replace",
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "stage": "run", "error": f"运行超时（>{timeout}s），可能存在死循环"}
        return {
            "ok": run.returncode == 0,
            "stdout": run.stdout,
            "stderr": run.stderr,
            "code": run.returncode,
            "runner": "本地 Python",
            **({"stage": "run", "error": run.stderr} if run.returncode != 0 else {}),
        }


# Wandbox 公共免费编译服务（无需密钥），作为无 gcc 时的云端兜底
def run_c_wandbox(code, timeout=30):
    payload = json.dumps({
        "code": code,
        "compiler": "gcc-head-c",
        "stdin": "",
        "options": "-std=c11 -Wall",
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://wandbox.org/api/compile.json",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DSTutor/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "stage": "network", "error": f"云端编译服务请求失败：{e}"}

    compiler_err = data.get("compiler_error") or ""
    status = data.get("status")
    stdout = data.get("program_output") or ""
    stderr = data.get("program_error") or ""

    # 编译失败：status 非 0 且编译器有 error 输出（仅有 warning 且运行成功不算失败）
    if status != "0" and compiler_err.strip() and not stdout:
        return {"ok": False, "stage": "compile", "error": compiler_err}

    if status != "0":
        signal = data.get("signal") or ""
        return {
            "ok": False, "stage": "run",
            "error": ((f"程序异常终止（signal={signal}）\n" if signal else "") + stderr).strip() or "程序运行失败",
            "stdout": stdout,
        }

    return {
        "ok": True,
        "stdout": stdout,
        "stderr": (compiler_err + stderr).strip() if (compiler_err + stderr).strip() else "",
        "code": 0,
        "runner": "Wandbox 云端",
    }

# ---------------------------------------------------------------- HTTP 服务
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    # ---------- 工具 ----------
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def _serve_static(self, path):
        if not path or path.endswith("/"):
            path = "index.html"
        full = os.path.normpath(os.path.join(WEB_DIR, path.lstrip("/")))
        if not full.startswith(WEB_DIR) or not os.path.isfile(full):
            self.send_error(404)
            return
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    # ---------- 路由 ----------
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/__api__/env":
            self._json({"compiler": find_compiler()})
        elif path.startswith("/__api__/"):
            self.send_error(404)
        else:
            self._serve_static(path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            body = self._read_body()
        except Exception:
            self._json({"error": "请求体解析失败"}, 400)
            return

        if path == "/__api__/run_c":
            code = body.get("code", "")
            result = run_c_local(code)
            if not result.get("ok") and result.get("stage") == "env" and body.get("allow_cloud", True):
                result = run_c_wandbox(code)
            self._json(result)
        elif path == "/__api__/run_python":
            self._json(run_python_local(body.get("code", "")))
        elif path == "/__api__/chat":
            self._proxy_chat(body)
        else:
            self.send_error(404)

    # ---------- LLM 流式代理（SSE 透传） ----------
    def _proxy_chat(self, body):
        base_url = body.pop("base_url", "").rstrip("/")
        api_key = body.pop("api_key", "")
        if not base_url:
            self._json({"error": {"message": "未配置 API 地址"}}, 400)
            return
        url = base_url + "/chat/completions"
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = "Bearer " + api_key

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            upstream = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            self._json({"error": {"message": f"上游返回 {e.code}：{detail[:500]}"}}, 502)
            return
        except Exception as e:
            self._json({"error": {"message": f"无法连接 API：{e}"}}, 502)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            while True:
                chunk = upstream.readline()
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            upstream.close()


# ---------------------------------------------------------------- 启动
def start_server(port=0):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    real_port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, real_port


WINDOW_TITLE = "数据结构陪学 Agent"


def _force_light_title_bar():
    """Windows 深色主题下窗口标题栏默认发黑，强制切为浅色以匹配纸墨主题"""
    if os.name != "nt":
        return
    import ctypes
    import time
    user32 = ctypes.windll.user32
    dwmapi = ctypes.windll.dwmapi
    hwnd = 0
    for _ in range(50):  # 最多等 10 秒窗口出现
        hwnd = user32.FindWindowW(None, WINDOW_TITLE)
        if hwnd:
            break
        time.sleep(0.2)
    if not hwnd:
        return
    value = ctypes.c_int(0)  # FALSE → 浅色标题栏
    # WebView2 初始化期间会重置该属性，启动后 12 秒内反复应用确保生效
    for _ in range(24):
        for attr in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE（20=Win10 2004+，19=更早版本）
            dwmapi.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(value), ctypes.sizeof(value))
        time.sleep(0.5)


def main():
    port = int(os.environ.get("DS_TUTOR_PORT", "0"))
    httpd, port = start_server(port)
    url = f"http://127.0.0.1:{port}/"
    print(f"服务已启动：{url}", flush=True)
    try:
        if os.environ.get("DS_TUTOR_NO_WEBVIEW") == "1":
            # 纯浏览器调试模式
            threading.Event().wait()
        else:
            threading.Thread(target=_force_light_title_bar, daemon=True).start()
            webview.create_window(
                WINDOW_TITLE,
                url=url,
                width=1280,
                height=860,
                min_size=(960, 640),
            )
            webview.start(debug=os.environ.get("DS_TUTOR_DEBUG") == "1")
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
