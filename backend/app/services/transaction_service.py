from backend.app.repositories.transaction_repository import db_repo
from datetime import datetime

class TransactionService:
    @staticmethod
    def get_history(limit: int = 100) -> list:
        """
        Fetch transaction history list.
        """
        return db_repo.get_all_transactions(limit=limit)

    @staticmethod
    def get_by_id(txn_id: str) -> dict | None:
        """
        Fetch detailed transaction record by ID.
        """
        conn = db_repo.get_connection()
        cursor = conn.execute("SELECT * FROM transactions WHERE transaction_id = ?", (txn_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    @staticmethod
    def get_analytics() -> dict:
        """
        Fetch real-time transaction count and fraud metrics.
        """
        return db_repo.get_analytics_summary()

transaction_service = TransactionService()
