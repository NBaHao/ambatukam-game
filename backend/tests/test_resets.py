"""Password reset by email (/api/auth/reset*) and changing the account's email (/api/me/email)."""

import re

import pytest
from fastapi.testclient import TestClient

from app import rules
from app.dependencies import get_mailer
from app.main import app
from app.services.mailer import Email
from app.services.resets import reset_email
from tests.conftest import TEST_CAPTCHA_OK, FakeClock
from tests.test_auth import PASSWORD, register

NEW_PASSWORD = "correct-horse-battery"


@pytest.fixture
def outbox(client: TestClient) -> list[Email]:
    sent: list[Email] = []

    async def send(mail: Email) -> None:
        sent.append(mail)

    app.dependency_overrides[get_mailer] = lambda: send
    return sent


def ask(client: TestClient, username: str = "haro", **extra):
    body = {"username": username, "captcha": TEST_CAPTCHA_OK, **extra}
    return client.post("/api/auth/reset/request", json=body)


def link_token(mail: Email) -> str:
    m = re.search(r"https://ambatukam\.bahao\.site/reset/([A-Za-z0-9_-]+)", mail.text)
    assert m, mail.text
    return m.group(1)


def test_off_without_email_service(client: TestClient):
    assert client.get("/api/auth/reset").json() == {"available": False}
    register(client, email="me@example.com")
    res = ask(client)
    assert res.status_code == 503 and res.json() == {"error": "reset_unavailable"}


def test_reset_flow(client: TestClient, outbox: list[Email], fake_clock: FakeClock):
    assert client.get("/api/auth/reset").json() == {"available": True}
    register(client, email="Me@Example.com")
    other = TestClient(client.app, base_url="https://testserver")  # a second device, logged in
    other.post("/api/auth/login", json={"username": "haro", "password": PASSWORD})
    assert other.get("/api/me").json()["user"]["username"] == "haro"

    res = ask(client, lang="vi")
    assert res.status_code == 200 and res.json() == {"available": True}
    assert len(outbox) == 1
    mail = outbox[0]
    assert mail.to == "me@example.com" and "Đặt lại" in mail.subject and "haro" in mail.text
    token = link_token(mail)
    assert f'href="https://ambatukam.bahao.site/reset/{token}"' in mail.html

    fake_clock.advance(60)
    res = client.post("/api/auth/reset", json={"token": token, "password": NEW_PASSWORD})
    assert res.status_code == 200, res.text
    assert res.json()["user"]["username"] == "haro"
    assert "amb_sid=" in res.headers["set-cookie"]
    assert client.get("/api/me").json()["user"]["username"] == "haro"
    assert other.get("/api/me").json() == {"user": None}  # every other session ended

    # One use only; the old password is gone, the new one works
    again = client.post("/api/auth/reset", json={"token": token, "password": NEW_PASSWORD})
    assert again.status_code == 400 and again.json() == {"error": "bad_reset"}
    bad = other.post("/api/auth/login", json={"username": "haro", "password": PASSWORD})
    assert bad.status_code == 401
    good = other.post("/api/auth/login", json={"username": "haro", "password": NEW_PASSWORD})
    assert good.status_code == 200


def test_same_answer_for_unknown_or_emailless_accounts(client: TestClient, outbox: list[Email]):
    register(client)  # no email
    assert ask(client).json() == {"available": True}
    assert ask(client, "nobody").json() == {"available": True}
    assert outbox == []


def test_captcha_and_cooldown(client: TestClient, outbox: list[Email], fake_clock: FakeClock):
    register(client, email="me@example.com")
    assert ask(client, captcha="nope").json() == {"error": "captcha"}
    ask(client)
    ask(client)  # too soon: silently skipped
    assert len(outbox) == 1
    fake_clock.advance(rules.RESET_GAP_SEC + 1)
    ask(client)
    assert len(outbox) == 2
    # Only the newest link works
    first, second = link_token(outbox[0]), link_token(outbox[1])
    res = client.post("/api/auth/reset", json={"token": first, "password": NEW_PASSWORD})
    assert res.json() == {"error": "bad_reset"}
    assert client.post("/api/auth/reset", json={"token": second, "password": NEW_PASSWORD}).status_code == 200


def test_link_expires(client: TestClient, outbox: list[Email], fake_clock: FakeClock):
    register(client, email="me@example.com")
    ask(client)
    fake_clock.advance(rules.RESET_TTL_MIN * 60 + 1)
    res = client.post("/api/auth/reset", json={"token": link_token(outbox[0]), "password": NEW_PASSWORD})
    assert res.json() == {"error": "bad_reset"}


def test_reset_validation(client: TestClient, outbox: list[Email]):
    assert client.post("/api/auth/reset", json={"token": "x", "password": "short"}).status_code == 422
    unknown = client.post("/api/auth/reset", json={"token": "unknown", "password": NEW_PASSWORD})
    assert unknown.status_code == 400
    assert ask(client, lang="fr").status_code == 422


def test_email_failure_is_reported(client: TestClient):
    async def broken(mail: Email) -> None:
        raise RuntimeError("down")

    app.dependency_overrides[get_mailer] = lambda: broken
    register(client, email="me@example.com")
    res = ask(client)
    assert res.status_code == 502 and res.json() == {"error": "email_failed"}


def test_change_email(client: TestClient, outbox: list[Email]):
    body = {"email": "new@example.com", "password": PASSWORD}
    assert client.put("/api/me/email", json=body).json() == {"error": "login_required"}
    register(client)
    assert client.get("/api/me").json()["user"]["email"] is None
    wrong = client.put("/api/me/email", json={**body, "password": "wrong-password"})
    assert wrong.status_code == 401 and wrong.json() == {"error": "bad_login"}
    res = client.put("/api/me/email", json=body)
    assert res.status_code == 200 and res.json()["user"]["email"] == "new@example.com"
    assert client.get("/api/me").json()["user"]["email"] == "new@example.com"
    ask(client)
    assert outbox[-1].to == "new@example.com"
    assert client.put("/api/me/email", json={"email": "bad", "password": PASSWORD}).status_code == 422
    removed = client.put("/api/me/email", json={"email": None, "password": PASSWORD})
    assert removed.json()["user"]["email"] is None


def test_email_html_escapes_name():
    mail = reset_email("a@b.co", "<x>", "https://e.x/reset/t", "en")
    assert "<x>" not in mail.html and "&lt;x&gt;" in mail.html
    assert 'href="https://e.x/reset/t"' in mail.html
