"""
Tiny in-process fixed-window rate limiter.

Used to blunt brute-force login attempts and abuse of the prediction
endpoints. IMPORTANT: the counter lives in the process's memory, so on a
horizontally-scaled platform (multiple serverless instances / workers) it is
approximate, not global - each instance enforces its own window. That is
still far better than nothing and costs zero infrastructure. A fully-accurate
global limiter (Redis/Upstash) is a Phase B hardening item.
"""

import time
from fastapi import Request, HTTPException

# key -> (max_requests, window_seconds)
_LIMITS = {
    "login": (15, 60),
    "predict": (60, 60),
}

_buckets: dict[str, list[float]] = {}


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check_rate_limit(scope_key: str, request: Request) -> None:
    limit, window = _LIMITS[scope_key]
    key = f"{scope_key}:{client_ip(request)}"

    now = time.time()
    times = _buckets.setdefault(key, [])
    # Drop timestamps that slid out of the window
    while times and times[0] <= now - window:
        times.pop(0)

    if len(times) >= limit:
        raise HTTPException(
            status_code=429,
            detail="Too many requests from this address. Please slow down and try again in a moment.",
        )

    times.append(now)