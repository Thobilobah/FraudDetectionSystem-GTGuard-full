from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str
    remember_me: bool = False


class AuthUser(BaseModel):
    email: str
    name: str
    role: str = "analyst"  # "admin" or "analyst"


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_hours: int = 24
    user: AuthUser
