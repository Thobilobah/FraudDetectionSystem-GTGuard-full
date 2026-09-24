"""Authorized logins for the GT GUARD dashboard.

Only the accounts listed here can sign in at POST /auth/login; every other
email/password combination is rejected with 401. Passwords are stored as
SHA-256 digests (constant-time comparison) rather than plaintext.

  Analysts (password "12345"): peace@gmail.com, jane@gmail.com,
                               esther@gmail.com, pelumi@gmail.com, tobi@gmail.com
  Admins   (password "admin"): admin@gmail.com, sup.admin@gmail.com
"""

import hashlib
import secrets

_RAW_CREDENTIALS = {
    # Analysts
    "peace@gmail.com": {"password": "12345", "role": "analyst"},
    "jane@gmail.com": {"password": "12345", "role": "analyst"},
    "esther@gmail.com": {"password": "12345", "role": "analyst"},
    "pelumi@gmail.com": {"password": "12345", "role": "analyst"},
    "tobi@gmail.com": {"password": "12345", "role": "analyst"},
    # Admins
    "admin@gmail.com": {"password": "admin", "role": "admin"},
    "sup.admin@gmail.com": {"password": "admin", "role": "admin"},
}


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


AUTH_CREDENTIALS = {
    email: {"password_hash": _sha256(cred["password"]), "role": cred["role"]}
    for email, cred in _RAW_CREDENTIALS.items()
}


def verify_credentials(email: str, password: str):
    """Return the role ("admin" | "analyst") for a matching email/password,
    or None if the credentials are not authorized."""
    entry = AUTH_CREDENTIALS.get(email)
    if not entry:
        return None
    if not secrets.compare_digest(entry["password_hash"], _sha256(password)):
        return None
    return entry["role"]