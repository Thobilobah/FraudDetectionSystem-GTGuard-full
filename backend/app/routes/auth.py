from fastapi import APIRouter, HTTPException, Request
from backend.app.schemas.auth import LoginRequest, LoginResponse, AuthUser
from backend.app.auth import create_access_token
from backend.app.services.rate_limiter import check_rate_limit
from backend.app.services.credential_store import verify_credentials

router = APIRouter()


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request):
    # Blunt brute-force password guessing before the allowlist check.
    # In-process/approximate across instances; better than nothing.
    check_rate_limit("login", request)
    email = (payload.email or "").strip().lower()
    password = payload.password or ""

    if not email or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if not password:
        raise HTTPException(status_code=400, detail="Password is required.")

    # Only the fixed analyst/admin accounts in credential_store.py can sign
    # in. Anything else - or a wrong password for a known account - gets the
    # same generic 401 so the response doesn't reveal which accounts exist.
    role = verify_credentials(email, password)
    if role is None:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_access_token(email, role)
    display_name = email.split("@")[0].replace(".", " ").replace("_", " ").replace("-", " ").title()

    return LoginResponse(
        access_token=token,
        user=AuthUser(email=email, name=display_name or "User", role=role)
    )
