"""Deterministic OpenManus execution sidecar for NaIA experiment EXEC-01.

Protocol: one JSON request on stdin, one framed JSON response on stdout.
This sidecar deliberately bypasses ReAct/LLM planning and exercises the
pinned OpenManus ToolCollection directly. It also avoids executing
app/tool/__init__.py because that package initializer imports unrelated tools
whose configuration path requires credentials (for example Daytona).
"""

import asyncio
import json
import sys
import types
from pathlib import Path
from typing import Any

RESULT_PREFIX = "NAIA_RESULT:"


def prepare_minimal_openmanus_imports() -> None:
    """Load only the OpenManus tool modules required by this experiment."""
    root = Path.cwd()
    tool_dir = root / "app" / "tool"
    if not (tool_dir / "base.py").is_file() or not (tool_dir / "tool_collection.py").is_file():
        raise RuntimeError(f"OpenManus tool modules not found under {tool_dir}")

    tool_package = types.ModuleType("app.tool")
    tool_package.__path__ = [str(tool_dir)]
    tool_package.__package__ = "app.tool"
    sys.modules["app.tool"] = tool_package

    # tool_collection.py imports app.logger only for duplicate-tool warnings.
    # The production logger imports app.config, which eagerly constructs the
    # entire application configuration. Stub only this logging dependency so
    # EXEC-01 remains scoped to ToolCollection semantics.
    logger_module = types.ModuleType("app.logger")

    class MinimalLogger:
        def warning(self, *_args: Any, **_kwargs: Any) -> None:
            return None

    logger_module.logger = MinimalLogger()
    sys.modules["app.logger"] = logger_module


prepare_minimal_openmanus_imports()

from app.tool.base import BaseTool, ToolResult  # noqa: E402
from app.tool.tool_collection import ToolCollection  # noqa: E402


class UppercaseTool(BaseTool):
    name: str = "text.uppercase"
    description: str = "Uppercase supplied text for a controlled benchmark."
    parameters: dict = {
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
        "additionalProperties": False,
    }

    async def execute(self, text: str, **_: Any) -> ToolResult:
        return ToolResult(output={"text": str(text).upper()})


class EchoTool(BaseTool):
    name: str = "text.echo"
    description: str = "Return supplied text unchanged for command/data separation tests."
    parameters: dict = {
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
        "additionalProperties": False,
    }

    async def execute(self, text: str, **_: Any) -> ToolResult:
        return ToolResult(output={"text": str(text)})


TOOLS = ToolCollection(UppercaseTool(), EchoTool())


def emit(response: dict[str, Any]) -> None:
    print(f"{RESULT_PREFIX}{json.dumps(response, separators=(',', ':'))}", flush=True)


async def handle(request: dict[str, Any]) -> dict[str, Any]:
    tool = request.get("tool")
    tool_input = request.get("input") or {}
    if not isinstance(tool, str) or not tool:
        return {"ok": False, "error": "tool is required", "retryable": False}
    if not isinstance(tool_input, dict):
        return {"ok": False, "error": "input must be an object", "retryable": False}

    try:
        result = await TOOLS.execute(name=tool, tool_input=tool_input)
    except Exception as exc:
        return {"ok": False, "error": str(exc), "retryable": False}

    if result.error:
        return {"ok": False, "error": result.error, "retryable": False}

    return {
        "ok": True,
        "output": {
            "tool": tool,
            "result": result.output,
        },
    }


async def main() -> int:
    raw = sys.stdin.readline()
    if not raw:
        emit({"ok": False, "error": "empty request", "retryable": False})
        return 2
    try:
        request = json.loads(raw)
    except json.JSONDecodeError:
        emit({"ok": False, "error": "invalid json", "retryable": False})
        return 2

    response = await handle(request)
    emit(response)
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
