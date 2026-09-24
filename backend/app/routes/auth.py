from fastapi import APIRouter, HTTPException, Request
from backend.app.schemas.auth import LoginRequest, LoginResponse, AuthUser
from backend.app.auth import create_access_token, determine_role
from backend.app.services.rate_limiter import check_rate_limit

router = APIRouter()


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request):
    # Blunt brute-force password guessing before the (demo-mode) acceptance
    # check. In-process/approximate across instances; better than nothing.
    check_rate_limit("login", request)
    email = (payload.email or "").strip().lower()
    password = payload.password or ""

    if not email or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if len(password) < 1:
        raise HTTPException(status_code=400, detail="Password is required.")

    # Demo Mode: any well-formed email + non-empty password is accepted here,
    # matching the same demo-mode pattern used for the Razorpay/GTCO webhook
    # integration elsewhere in this system. Swap this block for a real
    # lookup + password hash check against a users table before production.
    role = determine_role(email)
    token = create_access_token(email, role)
    display_name = email.split("@")[0].replace(".", " ").replace("_", " ").replace("-", " ").title()

    return LoginResponse(
        access_token=token,
        user=AuthUser(email=email, name=display_name or "User", role=role)
    )
