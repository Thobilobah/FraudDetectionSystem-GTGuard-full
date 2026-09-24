"""
PostgreSQL-backed transaction repository.

Migrated from SQLite. Uses a psycopg2 threaded connection pool so multiple
FastAPI workers / concurrent webhook requests can read & write without the
single-writer lock contention SQLite has.

A thin compatibility wrapper (_PGConnection / _PGCursor) is used so the rest
of the codebase (routes, feature_engineering.py, main.py health check) did
not need to change: `conn.execute(sql, params)` with "?" placeholders,
`cursor.fetchone()["col"]`, `dict(row)`, and `with get_connection() as conn:`
all continue to work exactly as they did against sqlite3.
"""

import os
import re
import json
import time
from datetime import datetime, timedelta
import pandas as pd
import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool
from backend.app.config import settings

_PLACEHOLDER_RE = re.compile(r"\?")

# Version gate for in-place column migrations. Bump this ONLY when adding a
# new migration step below; existing databases whose app_settings.schema_version
# already matches skip the per-column information_schema checks on every cold
# start (those checks were a serverless startup-cost multiplier).
SCHEMA_VERSION = "3"

# Cap how many historical rows feature engineering will load per queried
# user/beneficiary. Bounded windows keep prediction latency flat as the
# transactions table grows, instead of fetching the user's entire history
# into Python on every /predict.
WINDOW_LIMIT = int(os.getenv("FEATURE_WINDOW_LIMIT", "400"))

# Analytics summary is recomputed over indexed data; cache it for a few
# seconds so the dashboard's 5-10s polling doesn't rescan the table on every
# request from every open browser tab. In-memory (per-instance) by design.
ANALYTICS_CACHE_TTL = float(os.getenv("ANALYTICS_CACHE_TTL_SECONDS", "5"))

_analytics_cache = {"ts": 0.0, "data": None}


class _PGCursor:
    """Wraps a psycopg2 RealDictCursor so rows behave like sqlite3.Row
    (dict-style column access, and dict(row) works)."""

    def __init__(self, cursor):
        self._cursor = cursor

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    @property
    def rowcount(self):
        return self._cursor.rowcount


class _PGConnection:
    """Wraps a pooled psycopg2 connection to mimic the sqlite3.Connection
    API surface used throughout this project (execute/commit/close, and
    use as a context manager that commits on clean exit)."""

    def __init__(self, raw_conn, pool_ref):
        self._conn = raw_conn
        self._pool = pool_ref
        self._closed = False

    def execute(self, sql: str, params=None):
        pg_sql = _PLACEHOLDER_RE.sub("%s", sql)
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(pg_sql, params or ())
        return _PGCursor(cur)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        if not self._closed:
            self._pool.putconn(self._conn)
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            # Unlike sqlite3 (cheap per-file connections that can be left for
            # the garbage collector), a pooled connection MUST be returned
            # here or the pool silently exhausts after ~20 requests.
            self.close()
        return False


class TransactionRepository:
    _pool = None

    def __init__(self, database_url: str = None):
        self.database_url = database_url or settings.DATABASE_URL
        self._ensure_pool()
        self.init_db()

    def _ensure_pool(self):
        if TransactionRepository._pool is None:
            # Pool sizing is env-driven. In serverless (Vercel) each cold
            # start spins up a fresh instance-threaded pool, so we default
            # to LAZY connections (minconn=0) instead of eagerly opening 2
            # sockets against the hosted Postgres per instance.
            minconn = int(os.getenv("DB_POOL_MIN", "0"))
            maxconn = int(os.getenv("DB_POOL_MAX", "20"))
            TransactionRepository._pool = pg_pool.ThreadedConnectionPool(
                minconn=minconn,
                maxconn=maxconn,
                dsn=self.database_url,
            )
            print(f"PostgreSQL connection pool created ({minconn}-{maxconn} connections) for {self._safe_dsn()}")

    def _safe_dsn(self) -> str:
        # Hide credentials when logging the DSN
        return re.sub(r"//([^:@/]+)(:[^@/]*)?@", "//***:***@", self.database_url)

    def get_connection(self) -> _PGConnection:
        raw_conn = TransactionRepository._pool.getconn()
        return _PGConnection(raw_conn, TransactionRepository._pool)

    def get_setting(self, key: str) -> str | None:
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
                row = cursor.fetchone()
                return row["value"] if row else None
        except Exception as e:
            print(f"Error reading setting '{key}': {e}")
            return None

    def upsert_setting(self, key: str, value: str) -> bool:
        try:
            with self.get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO app_settings (key, value) VALUES (?, ?)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                    """,
                    (key, value),
                )
            return True
        except Exception as e:
            print(f"Error persisting setting '{key}'={value!r}: {e}")
            return False

    def init_db(self):
        with self.get_connection() as conn:
            # 1. Transactions Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transactions (
                    transaction_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    amount REAL,
                    transaction_type TEXT,
                    timestamp TEXT,
                    beneficiary_id TEXT,
                    device_id TEXT,
                    location_latitude REAL,
                    location_longitude REAL,
                    is_fraud INTEGER,
                    fraud_probability REAL,
                    risk_score INTEGER,
                    risk_level TEXT,
                    triggered_rules TEXT,
                    created_at TEXT,
                    payment_method TEXT DEFAULT 'USSD',
                    status TEXT DEFAULT 'APPROVED',
                    resolved_by TEXT,
                    resolved_at TEXT,
                    claimed_by TEXT,
                    claimed_at TEXT
                )
            """)

            # 2. User Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_profiles (
                    user_id TEXT PRIMARY KEY,
                    avg_amount REAL,
                    std_amount REAL,
                    avg_daily_txns REAL,
                    avg_hour REAL,
                    last_latitude REAL,
                    last_longitude REAL,
                    last_txn_time TEXT
                )
            """)

            # 3. Beneficiary Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS beneficiary_profiles (
                    beneficiary_id TEXT PRIMARY KEY,
                    age_days INTEGER,
                    risk_score REAL,
                    total_txns INTEGER,
                    unique_senders INTEGER
                )
            """)

            # 4. Device Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS device_profiles (
                    device_id TEXT PRIMARY KEY,
                    account_count INTEGER,
                    fraud_history INTEGER,
                    last_used_time TEXT
                )
            """)

            # 5. Location Profiles Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS location_profiles (
                    location_id TEXT PRIMARY KEY,
                    risk_score REAL
                )
            """)

            # 6. Application Settings Table (durable key/value so choices like
            # the active ML model survive serverless cold starts / redeploys)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)

            # Indexes for the hot query paths. CREATE INDEX IF NOT EXISTS is
            # idempotent (a no-op once present), so on the live Neon database
            # this block builds the indexes in-place on first deploy without
            # touching data, then skips them on every subsequent cold start.
            # Without these, every /predict feature query and the analytics
            # aggregate would full-scan the transactions table.
            conn.execute("CREATE INDEX IF NOT EXISTS idx_txn_user_time ON transactions (user_id, timestamp DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_txn_bene_time ON transactions (beneficiary_id, timestamp DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_txn_created ON transactions (created_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions (status)")

            conn.commit()

        # Gated migrations: pay the per-column information_schema checks only
        # when the schema version is stale. On a fresh DB this runs once; on
        # every cold start afterwards it is skipped entirely.
        current_version = self.get_setting("schema_version")
        if current_version != SCHEMA_VERSION:
            with self.get_connection() as conn:
                # Migration check: add any columns that don't exist yet
                # (payment_method, status, resolved_by, resolved_at, claimed_by,
                # claimed_at) - safe to re-run on an existing DB.
                for col_name, col_def in [
                    ("payment_method", "TEXT DEFAULT 'USSD'"),
                    ("status", "TEXT DEFAULT 'APPROVED'"),
                    ("resolved_by", "TEXT"),
                    ("resolved_at", "TEXT"),
                    ("claimed_by", "TEXT"),
                    ("claimed_at", "TEXT"),
                ]:
                    col_check = conn.execute("""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = 'transactions' AND column_name = ?
                    """, (col_name,))
                    if not col_check.fetchone():
                        conn.execute(f"ALTER TABLE transactions ADD COLUMN {col_name} {col_def}")
                conn.commit()
            self.upsert_setting("schema_version", SCHEMA_VERSION)

        # Seed profiles from CSV if database is empty
        self.seed_from_csv()

    def seed_from_csv(self):
        # Check if user_profiles is empty
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) as count FROM user_profiles")
            row = cursor.fetchone()
            if row["count"] > 0:
                print("Database already seeded.")
                return

        # Find CSV path
        csv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "dataset.csv"))
        if not os.path.exists(csv_path):
            print(f"Dataset CSV not found at {csv_path}. Skipping database seeding.")
            return

        print(f"Seeding database profiles from {csv_path}...")
        try:
            df = pd.read_csv(csv_path)
            # Some feature columns may be entirely empty for a given dataset
            # (e.g. no beneficiary/device history was collected); default them
            # to 0 so the int()/float() casts below don't choke on NaN.
            df = df.fillna(0)

            with self.get_connection() as conn:
                for idx, row in df.iterrows():
                    user_id = str(row["user_id"])

                    # 1. Seed User Profiles (upsert)
                    conn.execute("""
                        INSERT INTO user_profiles
                        (user_id, avg_amount, std_amount, avg_daily_txns, avg_hour, last_latitude, last_longitude, last_txn_time)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (user_id) DO UPDATE SET
                            avg_amount = EXCLUDED.avg_amount,
                            std_amount = EXCLUDED.std_amount,
                            avg_daily_txns = EXCLUDED.avg_daily_txns,
                            avg_hour = EXCLUDED.avg_hour,
                            last_latitude = EXCLUDED.last_latitude,
                            last_longitude = EXCLUDED.last_longitude,
                            last_txn_time = EXCLUDED.last_txn_time
                    """, (
                        user_id,
                        float(row["user_avg_transaction_amount"]),
                        float(row["user_transaction_std"]),
                        float(row["user_avg_daily_transactions"]),
                        float(row["user_avg_transaction_hour"]),
                        12.9716 + (idx % 100) * 0.001,
                        77.5946 + (idx % 100) * 0.001,
                        datetime.utcnow().isoformat()
                    ))

                    # 2. Seed Beneficiary Profiles (upsert)
                    beneficiary_id = f"vpa_{idx}@ussd"
                    conn.execute("""
                        INSERT INTO beneficiary_profiles
                        (beneficiary_id, age_days, risk_score, total_txns, unique_senders)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (beneficiary_id) DO UPDATE SET
                            age_days = EXCLUDED.age_days,
                            risk_score = EXCLUDED.risk_score,
                            total_txns = EXCLUDED.total_txns,
                            unique_senders = EXCLUDED.unique_senders
                    """, (
                        beneficiary_id,
                        int(row["beneficiary_age_days"]),
                        float(row["beneficiary_risk_score"]),
                        int(row["beneficiary_transaction_count_24h"]),
                        int(row["beneficiary_unique_senders_24h"])
                    ))

                    # 3. Seed Device Profiles (upsert)
                    device_id = f"dev_{idx}"
                    conn.execute("""
                        INSERT INTO device_profiles
                        (device_id, account_count, fraud_history, last_used_time)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT (device_id) DO UPDATE SET
                            account_count = EXCLUDED.account_count,
                            fraud_history = EXCLUDED.fraud_history,
                            last_used_time = EXCLUDED.last_used_time
                    """, (
                        device_id,
                        int(row["device_account_count"]),
                        int(row["device_fraud_history"]),
                        datetime.utcnow().isoformat()
                    ))

                    # 4. Seed Location Profiles (upsert)
                    location_id = f"loc_{idx}"
                    conn.execute("""
                        INSERT INTO location_profiles
                        (location_id, risk_score)
                        VALUES (?, ?)
                        ON CONFLICT (location_id) DO UPDATE SET
                            risk_score = EXCLUDED.risk_score
                    """, (
                        location_id,
                        float(row["location_risk_score"])
                    ))

                conn.commit()
            print("Database profiles seeded successfully!")
        except Exception as e:
            print(f"Error seeding database: {e}")

    # Transaction operations
    def save_transaction(self, txn_id: str, user_id: str, amount: float, txn_type: str,
                         timestamp: str, beneficiary_id: str, device_id: str,
                         latitude: float, longitude: float, is_fraud: int,
                         prob: float, score: int, level: str, rules: list,
                         payment_method: str = "USSD", status: str = "APPROVED") -> dict:
        with self.get_connection() as conn:
            rules_str = json.dumps(rules)
            created_at = datetime.now().isoformat()

            conn.execute("""
                INSERT INTO transactions
                (transaction_id, user_id, amount, transaction_type, timestamp, beneficiary_id, device_id,
                 location_latitude, location_longitude, is_fraud, fraud_probability, risk_score, risk_level,
                 triggered_rules, created_at, payment_method, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                txn_id, user_id, amount, txn_type, timestamp, beneficiary_id, device_id,
                latitude, longitude, is_fraud, prob, score, level, rules_str, created_at, payment_method, status
            ))

            # Update user profile dynamically
            cursor = conn.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,))
            user_prof = cursor.fetchone()
            if user_prof:
                total_txns = 10  # assume weight for history
                new_avg = (user_prof["avg_amount"] * total_txns + amount) / (total_txns + 1)
                conn.execute("""
                    UPDATE user_profiles
                    SET avg_amount = ?, last_latitude = ?, last_longitude = ?, last_txn_time = ?
                    WHERE user_id = ?
                """, (new_avg, latitude, longitude, timestamp, user_id))
            else:
                conn.execute("""
                    INSERT INTO user_profiles
                    (user_id, avg_amount, std_amount, avg_daily_txns, avg_hour, last_latitude, last_longitude, last_txn_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (user_id, amount, 100.0, 1.0, 12.0, latitude, longitude, timestamp))

            # Update beneficiary profile dynamically
            cursor = conn.execute("SELECT * FROM beneficiary_profiles WHERE beneficiary_id = ?", (beneficiary_id,))
            bene_prof = cursor.fetchone()
            if bene_prof:
                conn.execute("""
                    UPDATE beneficiary_profiles
                    SET total_txns = total_txns + 1
                    WHERE beneficiary_id = ?
                """, (beneficiary_id,))
            else:
                conn.execute("""
                    INSERT INTO beneficiary_profiles
                    (beneficiary_id, age_days, risk_score, total_txns, unique_senders)
                    VALUES (?, ?, ?, ?, ?)
                """, (beneficiary_id, 1, 10.0, 1, 1))

            # Update device profile dynamically
            cursor = conn.execute("SELECT * FROM device_profiles WHERE device_id = ?", (device_id,))
            dev_prof = cursor.fetchone()
            if dev_prof:
                conn.execute("""
                    UPDATE device_profiles
                    SET last_used_time = ?
                    WHERE device_id = ?
                """, (timestamp, device_id))
            else:
                conn.execute("""
                    INSERT INTO device_profiles
                    (device_id, account_count, fraud_history, last_used_time)
                    VALUES (?, ?, ?, ?)
                """, (device_id, 1, 0, timestamp))

            conn.commit()

        return {
            "transaction_id": txn_id,
            "user_id": user_id,
            "amount": amount,
            "transaction_type": txn_type,
            "timestamp": timestamp,
            "beneficiary_id": beneficiary_id,
            "device_id": device_id,
            "location_latitude": latitude,
            "location_longitude": longitude,
            "is_fraud": is_fraud,
            "fraud_probability": prob,
            "risk_score": score,
            "risk_level": level,
            "triggered_rules": rules,
            "created_at": created_at,
            "payment_method": payment_method,
            "status": status,
            "resolved_by": None,
            "resolved_at": None,
            "claimed_by": None,
            "claimed_at": None
        }

    def suspend_transaction(self, txn_id: str, flagged_by_email: str) -> dict:
        """An analyst flags a PENDING (medium-risk) transaction, which does two
        things in one atomic action: moves its status to SUSPENDED, and records
        that analyst's email as who flagged it - so it's visible to everyone
        else (including on a different login/device) that this one is now
        being handled, and by whom. Returns a dict with an 'error' key on
        failure so the route can translate it into the right HTTP status, or
        the updated row on success."""
        with self.get_connection() as conn:
            claimed_at = datetime.now().isoformat()
            # Atomic claim: the status='PENDING' guard inside the UPDATE makes
            # the check-and-set race-free. Two analysts suspending the same
            # transaction concurrently cannot both claim it - only one UPDATE
            # matches, the other affects 0 rows and falls through below.
            cursor = conn.execute("""
                UPDATE transactions
                SET status = 'SUSPENDED', claimed_by = ?, claimed_at = ?
                WHERE transaction_id = ? AND status = 'PENDING'
                RETURNING *
            """, (flagged_by_email, claimed_at, txn_id))
            updated = cursor.fetchone()
            conn.commit()

            if updated:
                return dict(updated)

            # No row was updated: it either doesn't exist or is no longer PENDING.
            cursor = conn.execute("SELECT * FROM transactions WHERE transaction_id = ?", (txn_id,))
            row = cursor.fetchone()
            if not row:
                return {"error": "not_found"}
            return {"error": "not_pending"}

    def resolve_transaction(self, txn_id: str, decision: str, resolved_by: str) -> dict | None:
        """Admin resolves a PENDING or SUSPENDED transaction to APPROVED or BLOCKED."""
        resolved_at = datetime.now().isoformat()
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM transactions WHERE transaction_id = ?", (txn_id,))
            row = cursor.fetchone()
            if not row:
                return None

            conn.execute("""
                UPDATE transactions
                SET status = ?, resolved_by = ?, resolved_at = ?,
                    is_fraud = ?
                WHERE transaction_id = ?
            """, (
                decision,
                resolved_by,
                resolved_at,
                1 if decision == "BLOCKED" else 0,
                txn_id
            ))
            conn.commit()

            cursor = conn.execute("SELECT * FROM transactions WHERE transaction_id = ?", (txn_id,))
            updated = cursor.fetchone()
            return dict(updated) if updated else None

    def get_recent_transactions(self, user_id: str, timestamp_iso: str, minutes_offset: int) -> list:
        try:
            current_time = datetime.fromisoformat(timestamp_iso.replace("Z", ""))
        except ValueError:
            current_time = datetime.utcnow()

        # Window the query in SQL (index-assisted on idx_txn_user_time) and
        # bound the row count so prediction latency stays flat as the table
        # grows, instead of loading every transaction the user has ever made.
        window_start = (current_time - timedelta(minutes=minutes_offset)).isoformat()
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions
                WHERE user_id = ? AND timestamp >= ?
                ORDER BY timestamp DESC
                LIMIT ?
            """, (user_id, window_start, WINDOW_LIMIT))

            rows = cursor.fetchall()
            matching = []
            for row in rows:
                try:
                    row_time = datetime.fromisoformat(str(row["timestamp"]).replace("Z", ""))
                    diff_seconds = (current_time - row_time).total_seconds()
                    if 0 <= diff_seconds <= (minutes_offset * 60):
                        matching.append(dict(row))
                except ValueError:
                    continue
            return matching

    def get_recent_beneficiary_transactions(self, beneficiary_id: str, timestamp_iso: str, minutes_offset: int) -> list:
        try:
            current_time = datetime.fromisoformat(timestamp_iso.replace("Z", ""))
        except ValueError:
            current_time = datetime.utcnow()

        window_start = (current_time - timedelta(minutes=minutes_offset)).isoformat()
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions
                WHERE beneficiary_id = ? AND timestamp >= ?
                ORDER BY timestamp DESC
                LIMIT ?
            """, (beneficiary_id, window_start, WINDOW_LIMIT))

            rows = cursor.fetchall()
            matching = []
            for row in rows:
                try:
                    row_time = datetime.fromisoformat(str(row["timestamp"]).replace("Z", ""))
                    diff_seconds = (current_time - row_time).total_seconds()
                    if 0 <= diff_seconds <= (minutes_offset * 60):
                        matching.append(dict(row))
                except ValueError:
                    continue
            return matching

    def get_features_context(self, user_id: str, beneficiary_id: str, timestamp_iso: str, minutes_offset: int = 1440) -> tuple:
        """Batched feature context: both the user's and the beneficiary's recent
        transactions for the requested lookback window, fetched in ONE indexed
        query instead of the 4-6 sequential round-trips feature engineering used
        to make per /predict. Returns (user_rows, beneficiary_rows), each list
        newest-first and capped at WINDOW_LIMIT. Callers slice/partition the
        rows in Python for velocity, daily, percentile and moving-average
        features."""
        try:
            current_time = datetime.fromisoformat(timestamp_iso.replace("Z", ""))
        except ValueError:
            current_time = datetime.utcnow()

        window_start = (current_time - timedelta(minutes=minutes_offset)).isoformat()
        double_limit = WINDOW_LIMIT * 2  # budget rows for both identities
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions
                WHERE (user_id = ? OR beneficiary_id = ?) AND timestamp >= ?
                ORDER BY timestamp DESC
                LIMIT ?
            """, (user_id, beneficiary_id, window_start, double_limit))

            user_rows = []
            beneficiary_rows = []
            for row in cursor.fetchall():
                try:
                    row_time = datetime.fromisoformat(str(row["timestamp"]).replace("Z", ""))
                    if (current_time - row_time).total_seconds() < 0:
                        continue
                except ValueError:
                    continue
                if row["user_id"] == user_id:
                    user_rows.append(dict(row))
                if row["beneficiary_id"] == beneficiary_id:
                    beneficiary_rows.append(dict(row))
                if len(user_rows) >= WINDOW_LIMIT and len(beneficiary_rows) >= WINDOW_LIMIT:
                    break
            # Both sides are capped independently: when one identity has fewer
            # than WINDOW_LIMIT matching rows inside the scan budget, the other
            # side must still be trimmed to the window limit (the break above
            # only fires when BOTH are full).
            return user_rows[:WINDOW_LIMIT], beneficiary_rows[:WINDOW_LIMIT]

    def get_user_profile(self, user_id: str) -> dict | None:
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_beneficiary_profile(self, beneficiary_id: str) -> dict | None:
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM beneficiary_profiles WHERE beneficiary_id = ?", (beneficiary_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_device_profile(self, device_id: str) -> dict | None:
        with self.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM device_profiles WHERE device_id = ?", (device_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_all_transactions(self, limit: int = 100) -> list:
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions
                ORDER BY created_at DESC
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]

    @staticmethod
    def _build_filters(search: str, risk_level: str, status: str) -> tuple:
        """Translate the pagination query params into (sql_fragment, params).
        Values are always bound as parameters (never f-string'd) to keep the
        existing ? -> %s placeholder wrapper happy and injection safe."""
        clauses = []
        params = []
        if search:
            like = f"%{search}%"
            clauses.append("(transaction_id ILIKE ? OR user_id ILIKE ? OR beneficiary_id ILIKE ?)")
            params.extend([like, like, like])
        if risk_level:
            clauses.append("risk_level = ?")
            params.append(risk_level)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where_sql = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        return where_sql, params

    def get_transactions_page(self, limit: int = 50, offset: int = 0,
                              search: str = "", risk_level: str = "", status: str = "",
                              sort: str = "desc") -> list:
        """Paginated, filtered transaction listing for the ledger. ORDER BY
        rides idx_txn_created; filters are bound params. `sort` is whitelisted
        (desc|asc) so it can never inject SQL."""
        order = "ASC" if sort == "asc" else "DESC"
        where_sql, params = self._build_filters(search, risk_level, status)
        with self.get_connection() as conn:
            cursor = conn.execute(f"""
                SELECT * FROM transactions
                {where_sql}
                ORDER BY created_at {order}
                LIMIT {limit} OFFSET {offset}
            """, tuple(params))
            return [dict(row) for row in cursor.fetchall()]

    def count_transactions(self, search: str = "", risk_level: str = "", status: str = "") -> int:
        where_sql, params = self._build_filters(search, risk_level, status)
        with self.get_connection() as conn:
            cursor = conn.execute(f"SELECT COUNT(*) AS total FROM transactions {where_sql}", tuple(params))
            return cursor.fetchone()["total"]

    def stream_transactions_in_range(self, start_date: str, end_date: str):
        """Server-side named cursor for the admin CSV export. Rows are
        streamed from Postgres in batches (itersize) and yielded one at a time
        instead of materializing the entire date range in memory. The pooled
        connection is always returned to the pool, even if the consumer stops
        iterating early."""
        raw_conn = self._pool.getconn()
        try:
            cursor = raw_conn.cursor(name="export_stream", cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.itersize = 500
            cursor.execute("""
                SELECT * FROM transactions
                WHERE created_at::date >= %s::date
                  AND created_at::date <= %s::date
                ORDER BY created_at DESC
            """, (start_date, end_date))
            for row in cursor:
                yield dict(row)
        finally:
            self._pool.putconn(raw_conn)

    def get_transactions_in_range(self, start_date: str, end_date: str) -> list:
        """Used by the admin CSV report export (small ranges) and retained for
        compatibility; large exports should use stream_transactions_in_range
        instead, which does not load the full range into memory."""
        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions
                WHERE created_at::date >= ?::date
                  AND created_at::date <= ?::date
                ORDER BY created_at DESC
            """, (start_date, end_date))
            return [dict(row) for row in cursor.fetchall()]

    def get_analytics_summary(self) -> dict:
        # Short TTL cache: the dashboard polls /analytics every few seconds
        # from every open tab. Recomputing even a single-pass aggregate on each
        # request is wasteful; 5s staleness is invisible on a live monitor.
        now = time.time()
        if _analytics_cache["data"] is not None and (now - _analytics_cache["ts"]) < ANALYTICS_CACHE_TTL:
            return _analytics_cache["data"]

        with self.get_connection() as conn:
            # One scan, not six: COUNT with FILTER aggregates every metric in a
            # single pass over the table (index-assisted on the risk/status
            # columns where relevant).
            cursor_summary = conn.execute("""
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE is_fraud = 1) AS fraud,
                    COUNT(*) FILTER (WHERE is_fraud = 0) AS genuine,
                    COUNT(*) FILTER (WHERE risk_score >= 70) AS high_risk
                FROM transactions
            """)
            summary = cursor_summary.fetchone()
            total = summary["total"]
            fraud = summary["fraud"]
            genuine = summary["genuine"]
            high_risk = summary["high_risk"]

            # Hourly trend restricted to the last 24 hours of created_at so it
            # rides idx_txn_created instead of grouping the entire table. The
            # ISO-text window comparison matches how created_at is written.
            window_start = (datetime.now() - timedelta(hours=24)).isoformat()
            cursor_trend = conn.execute("""
                SELECT to_char(created_at::timestamp, 'HH24') as hour,
                       COUNT(*) as count,
                       COALESCE(SUM(is_fraud), 0) as fraud_count
                FROM transactions
                WHERE created_at >= ?
                GROUP BY hour
                ORDER BY hour
            """, (window_start,))
            trend = [dict(row) for row in cursor_trend.fetchall()]

            result = {
                "total_transactions": total,
                "fraud_transactions": fraud,
                "genuine_transactions": genuine,
                "fraud_percentage": (fraud / total * 100) if total > 0 else 0.0,
                "high_risk_transactions": high_risk,
                "hourly_trend": trend
            }
            _analytics_cache["ts"] = now
            _analytics_cache["data"] = result
            return result


db_repo = TransactionRepository()
