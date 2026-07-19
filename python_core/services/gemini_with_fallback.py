"""Strict Gemini request helper retained under its legacy import path.

IRON B10: callers must provide one explicit model. This module never changes
model, strips schema, or converts provider errors into local content.
"""

from __future__ import annotations

import asyncio
from typing import Any


def generate_with_fallback(client, **kwargs: Any) -> Any:
    """Execute exactly one Gemini request with the caller-selected model."""
    model = str(kwargs.pop("model", "") or "").strip()
    if not model:
        raise ValueError("Gemini model is required; AI Novel does not choose a fallback model")
    return client.models.generate_content(model=model, **kwargs)


async def agenerate_with_fallback(client, **kwargs: Any) -> Any:
    return await asyncio.to_thread(generate_with_fallback, client, **kwargs)
