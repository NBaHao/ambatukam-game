"""Sending email through Resend (https://resend.com). Off unless RESEND_API_KEY is set."""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

RESEND_URL = "https://api.resend.com/emails"


@dataclass(frozen=True, slots=True)
class Email:
    to: str
    subject: str
    text: str
    html: str


# Sends one email; raises on failure. Injected so tests never call the network.
Send = Callable[[Email], Awaitable[None]]


def resend_sender(api_key: str, sender: str) -> Send:
    async def send(mail: Email) -> None:
        from workers import fetch  # only in the Python Workers runtime

        res = await fetch(
            RESEND_URL,
            method="POST",
            body=json.dumps(
                {
                    "from": sender,
                    "to": [mail.to],
                    "subject": mail.subject,
                    "text": mail.text,
                    "html": mail.html,
                }
            ),
            headers={
                "Authorization": f"Bearer {api_key}",
                "content-type": "application/json",
                "user-agent": "ambatukam",
            },
        )
        if res.status >= 400:
            raise RuntimeError(f"Resend {res.status}")

    return send


async def log_sender(mail: Email) -> None:
    """Local dev (MAIL_DEV_LOG=1): the email goes to the worker log. Never used in production."""
    print(f"mail (dev) to {mail.to}: {mail.subject}\n{mail.text}")
