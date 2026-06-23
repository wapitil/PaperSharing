#!/usr/bin/env python3
"""Generate a human-readable git commit message with sub2api / OpenCode provider config."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CONFIG_PATH = Path(__file__).with_name("config.json")
MAX_DIFF_CHARS = 60_000


@contextmanager
def progress(message: str):
    stop_event = threading.Event()

    def animate() -> None:
        frames = ("|", "/", "-", "\\")
        index = 0
        while not stop_event.is_set():
            print(f"\r{message} {frames[index % len(frames)]}", end="", flush=True)
            index += 1
            time.sleep(0.12)

    thread = threading.Thread(target=animate, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop_event.set()
        thread.join()
        print(f"\r{message} 完成" + " " * 12)


# ---------------- Git Helpers ---------------- #


def run_git(args: list[str], check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {message}")
    return result.stdout


def git_success(args: list[str]) -> bool:
    result = subprocess.run(
        ["git", *args],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def ensure_git_repo() -> None:
    run_git(["rev-parse", "--is-inside-work-tree"])


def truncate(text: str, limit: int = MAX_DIFF_CHARS) -> str:
    if len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit] + f"\n\n[diff truncated: {omitted} characters omitted]"


def collect_context() -> dict[str, str]:
    status = run_git(["status", "--short"])
    if not status.strip():
        raise SystemExit("No changes to commit.")
    return {
        "status": status,
        "diff_stat": run_git(["diff", "--stat", "HEAD"], check=False),
        "staged_diff": truncate(run_git(["diff", "--cached"], check=False)),
        "unstaged_diff": truncate(run_git(["diff"], check=False)),
        "recent_commits": run_git(["log", "--oneline", "-8"], check=False),
    }


# ---------------- Config / Sub2API ---------------- #


def load_config() -> tuple[str, str, str]:
    """
    Load opencode / sub2api provider config.
    Returns (base_url, model_name, api_key)
    """
    if not CONFIG_PATH.exists():
        raise RuntimeError(f"Missing config file: {CONFIG_PATH}")
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    # --- opencode provider format ---
    providers = config.get("provider", {})
    if not providers:
        raise RuntimeError("config.json provider is empty.")

    provider = next(iter(providers.values()))
    options = provider.get("options", {})
    models = provider.get("models", {})

    if not models:
        raise RuntimeError("config.json provider.models is empty.")

    # use first model
    first_model_key = next(iter(models.keys()))
    first_model = models[first_model_key]

    base_url = options.get("baseURL") or options.get("base_url")
    api_key = options.get("apiKey") or options.get("api_key")

    if isinstance(first_model, dict):
        model_name = first_model.get("name") or first_model_key
    else:
        model_name = first_model_key

    if not base_url:
        raise RuntimeError("Missing provider.options.baseURL in config.json.")
    if not api_key:
        raise RuntimeError("Missing provider.options.apiKey in config.json.")

    base_url = base_url.rstrip("/")
    if not base_url.endswith("/v1"):
        base_url += "/v1"

    return base_url, model_name, api_key


def chat_completion(messages: list[dict[str, str]]) -> str:
    base_url, model, api_key = load_config()
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "stream": False,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    request = Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            body = response.read().decode("utf-8")
            data = json.loads(body)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"sub2api request failed: HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"sub2api request failed: {exc.reason}") from exc
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected sub2api response: {data}") from exc


# ---------------- Commit Message ---------------- #


def build_prompt(
    context: dict[str, str],
    extra_instruction: str | None = None,
    previous_message: str | None = None,
) -> list[dict[str, str]]:
    system = """你是一个专门为中文个人知识库仓库生成 Git commit message 的助手。

规则：
- 只返回 commit message 本身，不要 Markdown 代码块，不要解释。
- 使用中文。
- 优先生成自然、可读、像人写的提交信息，不要过度追求极短。
- 第一行是清晰摘要，可以比传统 commit message 稍长。
- 如果有必要，空一行后用 1 到 4 条要点说明变化。
- 重点说明这次修改了什么、为什么有意义。
- 不要提到没有变化的文件。
- 不要编造 git status 或 diff 中不存在的信息。
- 尽量贴合仓库已有风格，例如“增加...”“修改...”“整理...”“修复...”。
"""

    user = f"""请根据下面的 Git 变化生成 commit message。

最近提交风格：
{context["recent_commits"]}

Git status：
{context["status"]}

Diff stat：
{context["diff_stat"]}

已暂存 diff：
{context["staged_diff"]}

未暂存 diff：
{context["unstaged_diff"]}
"""

    if previous_message:
        user += f"""

上一次生成的 commit message：
{previous_message}
"""

    if extra_instruction:
        user += f"""

用户对重新生成的要求：
{extra_instruction}
"""

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def normalize_message(message: str) -> str:
    lines = [line.rstrip() for line in message.strip().splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def stage_all_changes() -> None:
    run_git(["add", "-A"])


def create_commit(message: str) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as file:
        file.write(message)
        file.write("\n")
        message_path = Path(file.name)
    try:
        run_git(["commit", "-F", str(message_path)])
    finally:
        message_path.unlink(missing_ok=True)


# ---------------- CLI ---------------- #


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate and commit with an AI-written git commit message."
    )

    parser.add_argument(
        "--no-stage",
        action="store_true",
        help="Do not run git add -A before generating the message.",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    ensure_git_repo()

    if not args.no_stage:
        with progress("正在暂存所有变化"):
            stage_all_changes()

    with progress("正在读取 Git 变化"):
        context = collect_context()

    extra_instruction: str | None = None
    previous_message: str | None = None

    while True:
        print("\n正在生成 commit message，这可能需要几十秒，请稍等。")
        with progress("正在请求模型生成"):
            message = normalize_message(
                chat_completion(
                    build_prompt(
                        context=context,
                        extra_instruction=extra_instruction,
                        previous_message=previous_message,
                    )
                )
            )

        if not message:
            raise RuntimeError("sub2api returned an empty commit message.")

        print("\n生成的 commit message：")
        print("-" * 50)
        print(message)
        print("-" * 50)

        print("\n请选择：")
        print("  y = 使用这个 message 并提交")
        print("  r = 输入补充要求，重新生成")
        print("  q = 退出，不提交")

        choice = input("\n选择 [y/r/q]，直接回车等同于 y: ").strip().lower()

        if choice in {"y", "yes", ""}:
            if git_success(["diff", "--cached", "--quiet"]):
                print("No staged changes. Nothing to commit.", file=sys.stderr)
                return 1

            with progress("正在创建 Git commit"):
                create_commit(message)
            print("Commit created.")
            return 0

        if choice in {"r", "retry"}:
            previous_message = message
            extra_instruction = input("\n告诉我你想怎么改这个 commit message：").strip()

            if not extra_instruction:
                extra_instruction = "重新生成一个不同版本，保持中文自然可读。"

            continue

        if choice in {"q", "quit", "n", "no"}:
            print("Commit cancelled.")
            return 0

        print("无效选择，请输入 y、r或 q。")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
