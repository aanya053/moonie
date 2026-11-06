import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.brain_dump import ProposedTask


class BrainDumpProvider(Protocol):
    async def extract(self, text: str, now: datetime, timezone_name: str | None) -> list[ProposedTask]: ...


class ProviderUnavailable(Exception):
    pass


class ProviderFailure(Exception):
    pass


class OpenAICompatibleProvider:
    def __init__(self, api_key: str, base_url: str, model: str, timeout_seconds: float = 20.0):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def extract(self, text: str, now: datetime, timezone_name: str | None) -> list[ProposedTask]:
        return await asyncio.to_thread(self._extract_sync, text, now, timezone_name)

    def _extract_sync(self, text: str, now: datetime, timezone_name: str | None) -> list[ProposedTask]:
        schema = {
            "type": "object",
            "properties": {"tasks": {"type": "array", "items": {"type": "object"}}},
            "required": ["tasks"],
            "additionalProperties": False,
        }
        body = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_schema", "json_schema": {"name": "moonie_tasks", "strict": True, "schema": schema}},
            "messages": [
                {"role": "system", "content": "Extract only actionable tasks. Use ISO timestamps only when the text is sufficiently clear. Return JSON with a tasks array. Never invent exact dates from ambiguous language."},
                {"role": "user", "content": f"Current time: {now.isoformat()}\nUser timezone: {timezone_name or 'unknown'}\nText:\n{text}"},
            ],
        }
        request = Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
            raise ProviderFailure("The Brain Dump provider could not be reached.") from error

        try:
            content: Any = payload["choices"][0]["message"]["content"]
            parsed = json.loads(content) if isinstance(content, str) else content
            tasks = parsed["tasks"]
            return [ProposedTask.model_validate(item) for item in tasks]
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as error:
            raise ProviderFailure("The Brain Dump provider returned invalid structured data.") from error


def configured_provider() -> BrainDumpProvider:
    api_key = os.getenv("MOONIE_LLM_API_KEY", "").strip()
    provider = os.getenv("MOONIE_LLM_PROVIDER", "").strip().lower()
    if not api_key or provider != "openai_compatible":
        raise ProviderUnavailable("Brain Dump is unavailable until MOONIE_LLM_PROVIDER=openai_compatible and MOONIE_LLM_API_KEY are configured on the backend.")
    return OpenAICompatibleProvider(
        api_key=api_key,
        base_url=os.getenv("MOONIE_LLM_BASE_URL", "https://api.openai.com/v1"),
        model=os.getenv("MOONIE_LLM_MODEL", "gpt-4o-mini"),
    )


async def extract_proposals(text: str, now: datetime | None, timezone_name: str | None) -> list[ProposedTask]:
    try:
        provider = configured_provider()
    except ProviderUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    effective_now = now or datetime.now(timezone.utc)
    try:
        return await provider.extract(text, effective_now, timezone_name)
    except ProviderFailure as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
