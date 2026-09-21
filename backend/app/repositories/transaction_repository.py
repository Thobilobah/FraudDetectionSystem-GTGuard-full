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
from datetime import datetime
import pandas as pd
import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool
from backend.app.config import settings

_PLACEHOLDER_RE = re.compile(r"\?")


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
                    resolved_at TEXT
                )
            """)

            # Migration check: add any columns that don't exist yet (payment_method,
            # status, resolved_by, resolved_at) - safe to re-run on an existing DB.
            for col_name, col_def in [
                ("payment_method", "TEXT DEFAULT 'USSD'"),
                ("status", "TEXT DEFAULT 'APPROVED'"),
                ("resolved_by", "TEXT"),
                ("resolved_at", "TEXT"),
            ]:
                col_check = conn.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'transactions' AND column_name = ?
                """, (col_name,))
                if not col_check.fetchone():
                    conn.execute(f"ALTER TABLE transactions ADD COLUMN {col_name} {col_def}")

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

            conn.commit()

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
            "resolved_at": None
        }

    def resolve_transaction(self, txn_id: str, decision: str, resolved_by: str) -> dict | None:
        """Admin resolves a SUSPENDED transaction to APPROVED or BLOCKED."""
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

        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions
                WHERE user_id = ?
                ORDER BY timestamp DESC
            """, (user_id,))

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

        with self.get_connection() as conn:
            cursor = conn.execute("""
                SELECT * FROM transactions
                WHERE beneficiary_id = ?
                ORDER BY timestamp DESC
            """, (beneficiary_id,))

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

    def get_analytics_summary(self) -> dict:
        with self.get_connection() as conn:
            cursor_total = conn.execute("SELECT COUNT(*) as count FROM transactions")
            total = cursor_total.fetchone()["count"]

            cursor_fraud = conn.execute("SELECT COUNT(*) as count FROM transactions WHERE is_fraud = 1")
            fraud = cursor_fraud.fetchone()["count"]

            cursor_genuine = conn.execute("SELECT COUNT(*) as count FROM transactions WHERE is_fraud = 0")
            genuine = cursor_genuine.fetchone()["count"]

            cursor_high_risk = conn.execute("SELECT COUNT(*) as count FROM transactions WHERE risk_score >= 70")
            high_risk = cursor_high_risk.fetchone()["count"]

            # Hourly trend (Postgres equivalent of SQLite's strftime('%H', created_at))
            cursor_trend = conn.execute("""
                SELECT to_char(created_at::timestamp, 'HH24') as hour,
                       COUNT(*) as count,
                       SUM(is_fraud) as fraud_count
                FROM transactions
                GROUP BY hour
                ORDER BY hour
            """)
            trend = [dict(row) for row in cursor_trend.fetchall()]

            return {
                "total_transactions": total,
                "fraud_transactions": fraud,
                "genuine_transactions": genuine,
                "fraud_percentage": (fraud / total * 100) if total > 0 else 0.0,
                "high_risk_transactions": high_risk,
                "hourly_trend": trend
            }


db_repo = TransactionRepository()
