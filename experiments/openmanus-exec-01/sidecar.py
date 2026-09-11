"""Deterministic OpenManus execution sidecar for NaIA experiment EXEC-01.

Protocol: one JSON request on stdin, one framed JSON response on stdout.
This sidecar deliberately bypasses the ReAct/LLM planner and exercises
OpenManus ToolCollection directly.
"""

import asyncio
import json
import sys
from typing import Any

from app.tool.base import BaseTool, ToolResult
from app.tool.tool_collection import ToolCollection

RESULT_PREFIX = "NAIA_RESULT:"


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
    except Exception as exc:  # fail closed at the process boundary
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
