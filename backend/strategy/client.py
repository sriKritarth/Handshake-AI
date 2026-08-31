"""LLM Client interface and Groq implementation for Strategy Engine."""
from __future__ import annotations
import os
from typing import Any, Dict, List, Optional, Protocol, Type, Union, runtime_checkable
import httpx
import instructor
from dotenv import load_dotenv
from groq import Groq , RateLimitError , APIStatusError , APITimeoutError , APIConnectionError
from pydantic import BaseModel

load_dotenv(".env")


class LLMClientError(Exception):
    """Raised when an LLM client encounters an API or network error."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        is_rate_limit: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.is_rate_limit = is_rate_limit or (status_code == 429)


@runtime_checkable
class LLMClient(Protocol):
    """Protocol for pluggable LLM clients used by the Strategy Engine."""

    def complete(
        self,
        messages: List[Dict[str, str]],
        schema_hint: Optional[Dict[str, Any]] = None,
        response_model: Optional[Type[BaseModel]] = None,
    ) -> Union[str, BaseModel]:
        """Send a completion request to the LLM.

        Args:
            messages: List of chat messages (role + content dicts).
            schema_hint: Optional template guide passed to the client.
            response_model: Optional Pydantic model for structured instructor responses.

        Returns:
            The raw text content or validated Pydantic model returned by the LLM.

        Raises:
            LLMClientError: On network, HTTP, or rate limit failure.
        """
        ...


class GroqLLMClient:
    """Groq API client implementing LLMClient with instructor structured output support."""

    GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(
        self,
        model: str = "Qwen/Qwen3.8-27B",
        api_key: Optional[str] = os.environ.get("GROQ_API_KEY", ""),
        timeout: float = 10.0,
        temperature: float = 0.2,
        max_retries: int = 2,
    ) -> None:
        self.model = model
        self.api_key = api_key if api_key is not None else os.environ.get("GROQ_API_KEY", "")
        self.timeout = timeout
        self.temperature = temperature
        self.max_retries = max_retries
        self._instructor_client: Optional[instructor.Instructor] = None

    def _get_instructor_client(self) -> instructor.Instructor:
        """Lazily initialize instructor-patched OpenAI client pointing to Groq."""
        if not self.api_key:
            raise LLMClientError(
                "Groq API key not provided and GROQ_API_KEY environment variable is not set."
            )
        if self._instructor_client is None:
            raw_client = Groq(
                api_key=self.api_key,
                timeout=self.timeout,
            )
            self._instructor_client = instructor.from_groq(
                raw_client,
                mode=instructor.Mode.JSON,
            )
        return self._instructor_client

    def complete(
        self,
        messages: List[Dict[str, str]],
        schema_hint: Optional[Dict[str, Any]] = None,
        response_model: Optional[Type[BaseModel]] = None,
    ) -> Union[str, BaseModel]:
        """Call Groq API, using instructor when response_model is provided."""
        if not self.api_key:
            raise LLMClientError(
                "Groq API key not provided and GROQ_API_KEY environment variable is not set."
            )

        if response_model is not None:
            try:
                client = self._get_instructor_client()
                return client.chat.completions.create(
                    model=self.model,
                    messages=messages,  # type: ignore
                    response_model=response_model,
                    max_retries=self.max_retries,
                    temperature=self.temperature,
                )
            except RateLimitError as exc:
                raise LLMClientError(
                    f"Groq rate limit exceeded (HTTP 429): {exc}",
                    status_code=429,
                    is_rate_limit=True,
                ) from exc
            except APIStatusError as exc:
                is_429 = exc.status_code == 429
                raise LLMClientError(
                    f"Groq API error (HTTP {exc.status_code}): {exc}",
                    status_code=exc.status_code,
                    is_rate_limit=is_429,
                ) from exc
            except APITimeoutError as exc:
                raise LLMClientError(f"Groq request timed out: {exc}") from exc
            except APIConnectionError as exc:
                raise LLMClientError(f"Groq network error: {exc}") from exc
            except Exception as exc:
                if isinstance(exc, LLMClientError):
                    raise
                raise LLMClientError(f"Unexpected error communicating with Groq: {exc}") from exc

        # Fallback to direct HTTP completion for compatibility
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "response_format": {"type": "json_object"},
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    self.GROQ_API_URL,
                    headers=headers,
                    json=payload,
                )

                if response.status_code == 429:
                    raise LLMClientError(
                        f"Groq rate limit exceeded (HTTP 429): {response.text}",
                        status_code=429,
                        is_rate_limit=True,
                    )

                if response.status_code != 200:
                    raise LLMClientError(
                        f"Groq API error (HTTP {response.status_code}): {response.text}",
                        status_code=response.status_code,
                        is_rate_limit=False,
                    )

                data = response.json()
                choices = data.get("choices", [])
                if not choices:
                    raise LLMClientError("Groq response contained no completion choices.")

                message = choices[0].get("message", {})
                content = message.get("content", "")
                if not content:
                    raise LLMClientError("Groq response choice contained empty content.")

                return str(content)

        except httpx.TimeoutException as exc:
            raise LLMClientError(f"Groq request timed out: {exc}") from exc
        except httpx.RequestError as exc:
            raise LLMClientError(f"Groq network error: {exc}") from exc
        except Exception as exc:
            if isinstance(exc, LLMClientError):
                raise
            raise LLMClientError(f"Unexpected error communicating with Groq: {exc}") from exc
