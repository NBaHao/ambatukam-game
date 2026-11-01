"""Password hashing with PBKDF2-SHA256.

Pyodide's hashlib has no pbkdf2_hmac, so the Worker uses WebCrypto. The key derivation function is
passed in (`Kdf`) so tests can use CPython's hashlib instead.
"""

import hmac
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

# (password, salt, iterations) -> 32-byte derived key
Kdf = Callable[[bytes, bytes, int], Awaitable[bytes]]

SALT_BYTES = 16


@dataclass(frozen=True, slots=True)
class PasswordHash:
    hash: str
    salt: str
    iterations: int


async def hash_password(kdf: Kdf, password: str, iterations: int) -> PasswordHash:
    salt = secrets.token_bytes(SALT_BYTES)
    key = await kdf(password.encode(), salt, iterations)
    return PasswordHash(hash=key.hex(), salt=salt.hex(), iterations=iterations)


async def verify_password(kdf: Kdf, password: str, stored: PasswordHash) -> bool:
    key = await kdf(password.encode(), bytes.fromhex(stored.salt), stored.iterations)
    return hmac.compare_digest(key.hex(), stored.hash)


async def workers_pbkdf2(password: bytes, salt: bytes, iterations: int) -> bytes:
    from js import Object, Uint8Array, crypto  # only available in the Python Workers runtime
    from pyodide.ffi import to_js

    key = await crypto.subtle.importKey(
        "raw", Uint8Array.new(to_js(list(password))), "PBKDF2", False, to_js(["deriveBits"])
    )
    params = to_js(
        {
            "name": "PBKDF2",
            "hash": "SHA-256",
            "salt": Uint8Array.new(to_js(list(salt))),
            "iterations": iterations,
        },
        dict_converter=Object.fromEntries,
    )
    bits = await crypto.subtle.deriveBits(params, key, 256)
    return bytes(Uint8Array.new(bits).to_py())
