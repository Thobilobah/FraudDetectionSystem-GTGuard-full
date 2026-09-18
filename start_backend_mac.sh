#!/bin/bash
# macOS launcher for the UPI FraudGuard AI backend.
# Requires DYLD_LIBRARY_PATH so homebrew expat fixes pyexpat (macOS 26 libexpat lacks a symbol).
cd "$(dirname "$0")"
DYLD_LIBRARY_PATH=/usr/local/opt/expat/lib venv/bin/python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload