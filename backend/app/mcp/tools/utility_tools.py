"""Offline utility MCP tools: date/time, safe AST calculator, unit converter, text summarizer."""

from __future__ import annotations

import ast
import math
import operator
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

_ALLOWED_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_ALLOWED_UNARYOPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

_ALLOWED_FUNCS = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "log10": math.log10,
    "ceil": math.ceil,
    "floor": math.floor,
}

_ALLOWED_CONSTS = {
    "pi": math.pi,
    "e": math.e,
}


def _eval_ast_node(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_ast_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.Name) and node.id in _ALLOWED_CONSTS:
        return _ALLOWED_CONSTS[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_BINOPS:
        left = _eval_ast_node(node.left)
        right = _eval_ast_node(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 1000:
            raise ValueError("Exponent too large.")
        return float(_ALLOWED_BINOPS[type(node.op)](left, right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _ALLOWED_UNARYOPS:
        return float(_ALLOWED_UNARYOPS[type(node.op)](_eval_ast_node(node.operand)))
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        fn = _ALLOWED_FUNCS.get(node.func.id)
        if fn is None or node.keywords:
            raise ValueError(f"Unsupported function '{node.func.id}'.")
        args = [_eval_ast_node(a) for a in node.args]
        return float(fn(*args))
    raise ValueError("Unsupported mathematical expression.")


def get_current_date_time() -> Dict[str, Any]:
    local_now = datetime.now().astimezone()
    utc_now = datetime.now(timezone.utc)
    return {
        "local_iso": local_now.isoformat(),
        "local_readable": local_now.strftime("%A, %B %d, %Y %I:%M %p %Z"),
        "utc_iso": utc_now.isoformat(),
        "unix_timestamp": int(utc_now.timestamp()),
    }


def perform_calculation(expression: str) -> Dict[str, Any]:
    expr = (expression or "").strip()
    if not expr or len(expr) > 200:
        raise ValueError("Expression must be between 1 and 200 characters.")
    cleaned = expr.replace("^", "**").replace("×", "*").replace("÷", "/")
    tree = ast.parse(cleaned, mode="eval")
    result = _eval_ast_node(tree)
    formatted = int(result) if result.is_integer() else round(result, 8)
    return {"expression": expr, "result": formatted}


_UNIT_FACTORS: Dict[str, tuple[str, float]] = {
    # Length -> meters
    "m": ("length", 1.0),
    "meter": ("length", 1.0),
    "meters": ("length", 1.0),
    "km": ("length", 1000.0),
    "kilometer": ("length", 1000.0),
    "kilometers": ("length", 1000.0),
    "cm": ("length", 0.01),
    "mm": ("length", 0.001),
    "mi": ("length", 1609.344),
    "mile": ("length", 1609.344),
    "miles": ("length", 1609.344),
    "ft": ("length", 0.3048),
    "foot": ("length", 0.3048),
    "feet": ("length", 0.3048),
    "in": ("length", 0.0254),
    "inch": ("length", 0.0254),
    "inches": ("length", 0.0254),
    # Mass -> grams
    "g": ("mass", 1.0),
    "gram": ("mass", 1.0),
    "grams": ("mass", 1.0),
    "kg": ("mass", 1000.0),
    "kilogram": ("mass", 1000.0),
    "kilograms": ("mass", 1000.0),
    "lb": ("mass", 453.59237),
    "lbs": ("mass", 453.59237),
    "pound": ("mass", 453.59237),
    "pounds": ("mass", 453.59237),
    "oz": ("mass", 28.349523125),
    # Data -> bytes
    "b": ("data", 1.0),
    "kb": ("data", 1024.0),
    "mb": ("data", 1024.0**2),
    "gb": ("data", 1024.0**3),
    "tb": ("data", 1024.0**4),
    # Time -> seconds
    "s": ("time", 1.0),
    "sec": ("time", 1.0),
    "seconds": ("time", 1.0),
    "min": ("time", 60.0),
    "minute": ("time", 60.0),
    "minutes": ("time", 60.0),
    "h": ("time", 3600.0),
    "hr": ("time", 3600.0),
    "hour": ("time", 3600.0),
    "hours": ("time", 3600.0),
}


def convert_units(value: float, from_unit: str, to_unit: str) -> Dict[str, Any]:
    val = float(value)
    fu = (from_unit or "").strip().lower()
    tu = (to_unit or "").strip().lower()

    temp_aliases = {"c": "c", "celsius": "c", "f": "f", "fahrenheit": "f", "k": "k", "kelvin": "k"}
    if fu in temp_aliases and tu in temp_aliases:
        f_t, t_t = temp_aliases[fu], temp_aliases[tu]
        c_val = val if f_t == "c" else ((val - 32.0) * 5.0 / 9.0 if f_t == "f" else val - 273.15)
        out = c_val if t_t == "c" else (c_val * 9.0 / 5.0 + 32.0 if t_t == "f" else c_val + 273.15)
        return {"value": val, "from_unit": from_unit, "to_unit": to_unit, "result": round(out, 4)}

    if fu not in _UNIT_FACTORS or tu not in _UNIT_FACTORS:
        raise ValueError(f"Unsupported unit conversion: '{from_unit}' -> '{to_unit}'.")
    cat_a, fac_a = _UNIT_FACTORS[fu]
    cat_b, fac_b = _UNIT_FACTORS[tu]
    if cat_a != cat_b:
        raise ValueError(f"Incompatible unit categories: '{from_unit}' ({cat_a}) vs '{to_unit}' ({cat_b}).")

    converted = (val * fac_a) / fac_b
    return {"value": val, "from_unit": from_unit, "to_unit": to_unit, "result": round(converted, 6)}


def summarize_text(text: str, max_sentences: int = 3) -> Dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Text to summarize cannot be empty.")
    max_sentences = max(1, min(10, int(max_sentences)))
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", raw) if s.strip()]
    if len(sentences) <= max_sentences:
        return {"original_words": len(raw.split()), "summary": raw, "sentence_count": len(sentences)}

    # Frequency-based extractive summarization (pure offline)
    words = re.findall(r"[a-zA-Z0-9']+", raw.lower())
    freq: Dict[str, int] = {}
    for w in words:
        if len(w) > 3:
            freq[w] = freq.get(w, 0) + 1

    scored = []
    for idx, sent in enumerate(sentences):
        score = sum(freq.get(w, 0) for w in re.findall(r"[a-zA-Z0-9']+", sent.lower()))
        scored.append((score, idx, sent))
    top = sorted(sorted(scored, key=lambda x: x[0], reverse=True)[:max_sentences], key=lambda x: x[1])
    summary = " ".join(s for _, _, s in top)
    return {
        "original_words": len(raw.split()),
        "summary_words": len(summary.split()),
        "sentence_count": len(top),
        "summary": summary,
    }


TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "name": "get_current_date_time",
        "category": "utility",
        "description": "Get current local date, time, timezone, and UTC timestamp.",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": get_current_date_time,
    },
    {
        "name": "perform_calculation",
        "category": "utility",
        "description": "Safely evaluate arithmetic and scientific math expressions using AST parsing.",
        "inputSchema": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
        "handler": perform_calculation,
    },
    {
        "name": "convert_units",
        "category": "utility",
        "description": "Convert values between length, mass, temperature, data size, and time units.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "value": {"type": "number"},
                "from_unit": {"type": "string"},
                "to_unit": {"type": "string"},
            },
            "required": ["value", "from_unit", "to_unit"],
        },
        "handler": convert_units,
    },
    {
        "name": "summarize_text",
        "category": "utility",
        "description": "Summarize a block of text locally using extractive sentence scoring.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "max_sentences": {"type": "integer", "minimum": 1, "maximum": 10, "default": 3},
            },
            "required": ["text"],
        },
        "handler": summarize_text,
    },
]
