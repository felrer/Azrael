"""Create a Backend.AI session cookie from credentials received over stdin."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import NoReturn


ENDPOINT = "https://www.ainexus.ktcloud.com"
ACCOUNT_PATTERN = re.compile(r"^(?:trinity|abydos|arius[1-9][0-9]*)$")


def fail(message: str, exit_code: int = 1) -> NoReturn:
    print(f"kt cloud login: {message}", file=sys.stderr)
    raise SystemExit(exit_code)


def main() -> int:
    if sys.platform == "win32":
        # Required by aiodns/pycares in the Windows Backend.AI client bundle.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        import aiohttp.connector
        from aiohttp.resolver import ThreadedResolver
        # Use Windows system DNS; c-ares may fail despite working OS resolution.
        aiohttp.connector.DefaultResolver = ThreadedResolver

    try:
        payload = json.loads(sys.stdin.readline())
        account = payload["account"]
        user_id = payload["user_id"]
        password = payload["password"]
        state_path = Path(payload["state_path"]).resolve()
    except (json.JSONDecodeError, KeyError, TypeError):
        fail("invalid credential input")

    if not isinstance(account, str) or ACCOUNT_PATTERN.fullmatch(account) is None:
        fail("the account alias is invalid")
    if not isinstance(user_id, str) or not user_id.strip():
        fail("the stored user ID is empty")
    if not isinstance(password, str) or not password:
        fail("the stored password is empty")

    expected_state_path = (
        Path(os.environ["LOCALAPPDATA"])
        / "ktcloud-ai-nexus"
        / "backend-state"
        / account
        / "Lablup"
        / "backend.ai"
    ).resolve()
    if state_path != expected_state_path:
        fail("the isolated Backend.AI state path is invalid")

    import appdirs

    original_user_state_dir = appdirs.user_state_dir

    def isolated_user_state_dir(
        appname: str | None = None,
        appauthor: str | None = None,
        version: str | None = None,
        roaming: bool = False,
    ) -> str:
        if appname == "backend.ai" and appauthor == "Lablup":
            return str(state_path)
        return original_user_state_dir(appname, appauthor, version, roaming)

    appdirs.user_state_dir = isolated_user_state_dir

    try:
        from ai.backend.client.config import APIConfig, local_state_path
        from ai.backend.client.session import Session
    except ImportError as exc:
        fail(f"Backend.AI client SDK is unavailable ({exc})")

    config = APIConfig(endpoint=ENDPOINT, endpoint_type="session")
    try:
        try:
            with Session(config=config) as session:
                result = session.Auth.login(user_id.strip(), password)
                if not result.get("authenticated"):
                    details = result.get("data", {}).get("details", "unknown reason")
                    if details == "OTP not provided":
                        fail("this account requires OTP; unattended login was not attempted")
                    fail(f"authentication failed ({details})")

                sdk_state_path = Path(local_state_path)
                if sdk_state_path.resolve() != state_path:
                    fail("Backend.AI SDK did not adopt the isolated state path")
                state_path.mkdir(parents=True, exist_ok=True)
                session.aiohttp_session.cookie_jar.update_cookies(result["cookies"])
                session.aiohttp_session.cookie_jar.save(state_path / "cookie.dat")
                (state_path / "config.json").write_text(
                    json.dumps(result.get("config", {})), encoding="utf-8"
                )
        except Exception as exc:
            # Avoid dumping request objects which might contain authentication data.
            # A missing module name is safe and makes an incomplete managed runtime
            # diagnosable without exposing the request, credentials, or response.
            if isinstance(exc, ModuleNotFoundError) and exc.name:
                fail(f"login request failed (missing module: {exc.name})")
            cause = exc.__cause__ or exc.__context__
            cause_name = type(cause).__name__ if cause is not None else "none"
            status = getattr(exc, "status", None)
            http_info = f"; HTTP={status}" if type(status) is int else ""
            # Emit only fixed diagnostic labels, never arbitrary server text.
            error_text = json.dumps(getattr(exc, "data", None), default=lambda _: "").lower()
            labels = {
                "user credential mismatch": "credential-mismatch",
                "password-expired": "password-expired",
                "require-totp-registration": "require-totp-registration",
                "require-totp-authentication": "require-totp-authentication",
                "active-login-session-exists": "active-login-session-exists",
                "login-session-expired": "login-session-expired",
                "auth-failed": "auth-failed",
                "rejected-by-hook": "rejected-by-hook",
                "invalid credentials": "invalid-credentials",
                "invalid username or password": "invalid-credentials",
                "password expired": "password-expired",
                "password has expired": "password-expired",
                "too many": "rate-limit",
                "blocked": "account-blocked",
                "otp": "otp-related",
            }
            categories = sorted({label for phrase, label in labels.items() if phrase in error_text})
            if categories:
                http_info += "; category=" + ",".join(categories)
            fail(f"login request failed ({type(exc).__name__}; cause={cause_name}{http_info})")
    finally:
        # Best effort only: Python strings cannot be reliably zeroed.
        password = None
        payload = None

    print("kt cloud Backend.AI CLI login succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
