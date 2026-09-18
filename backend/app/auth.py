"""
Lightweight JWT authentication for the GT GUARD / FraudGuard AI dashboard.

Runs in the same "Demo Mode" spirit as the rest of this system's third-party
integrations (Razorpay, GTCO webhooks): any well-formed email + non-empty
password is accepted at /auth/login and issued a real, signed JWT. That token
is then required on every protected API route via `get_current_user`, so the
login screen genuinely gates access to the dashboard's data - it isn't just a
cosmetic frontend check.

To move this to production, replace the acceptance logic in
routes/auth.py::login with a real credential check against a users table
(hashed passwords, etc.) - the token issuing/verification plumbing below
does not need to change.
"""

import os
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import Header, HTTPException, Depends

SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "fraudguard-demo-secret-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24


def determine_role(email: str) -> str:
    """Demo-mode role assignment: any email containing 'admin' is treated as
    an admin account (can resolve suspended transactions). Everyone else is
    a regular analyst (view-only on suspended transactions). Swap this for a
    real roles table lookup in production."""
    return "admin" if "admin" in email.lower() else "analyst"


def create_access_token(email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


def get_current_user(authorization: str = Header(None)) -> dict:
    """FastAPI dependency: require a valid 'Authorization: Bearer <token>' header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated. Please sign in.")

    token = authorization.split(" ", 1)[1].strip()
    payload = decode_access_token(token)
    return {"email": payload.get("sub"), "role": payload.get("role", "analyst")}


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: require the signed-in user to have the admin role."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only an admin can resolve a suspended transaction."
        )
    return current_user
