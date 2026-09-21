import os
import json
from fastapi import APIRouter, HTTPException
from backend.app.config import settings
from backend.app.repositories.transaction_repository import db_repo
from backend.app.services.prediction_service import prediction_service

router = APIRouter()

@router.get("/analytics")
def get_analytics():
    try:
        # Get transaction database summaries
        summary = db_repo.get_analytics_summary()
        
        # Load model metadata
        metadata = None
        metadata_path = os.path.abspath(settings.METADATA_PATH)
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    metadata = json.load(f)
            except Exception as e:
                print(f"Error loading metadata: {e}")

        # Durable override: the /model/select endpoint persists the active
        # model in PostgreSQL (the serverless filesystem is read-only, so the
        # baked-in JSON can't change). Surface the persisted model + metrics
        # so every instance reports the same active model.
        try:
            db_active = db_repo.get_setting("active_model")
            if db_active and (metadata is None or metadata.get("selected_model") != db_active):
                csv_meta = prediction_service._metadata_from_comparison(db_active)
                if csv_meta:
                    metadata = csv_meta
                active_model_name = db_active
            else:
                active_model_name = metadata.get("selected_model") if metadata else None
        except Exception as e:
            print(f"Error applying DB model override: {e}")
            active_model_name = metadata.get("selected_model") if metadata else None

        # Load model comparison report if it exists
        comparison = []
        reports_dir = os.path.abspath(settings.REPORTS_DIR)
        comp_csv = os.path.join(reports_dir, "model_comparison.csv")
        if os.path.exists(comp_csv):
            import pandas as pd
            try:
                comp_df = pd.read_csv(comp_csv)
                comparison = comp_df.to_dict(orient="records")
            except Exception as e:
                print(f"Error loading comparison CSV: {e}")
                
        # Load feature importance for the ACTIVE model (per-model files exist
        # for every candidate; the copied feature_importance.csv may be stale
        # on serverless since its write is best-effort).
        importances = []
        try:
            if active_model_name:
                feat_fn = "feature_importance_" + active_model_name.lower().replace(" ", "_") + ".csv"
                feat_csv = os.path.join(reports_dir, feat_fn)
                if not os.path.exists(feat_csv):
                    feat_csv = os.path.join(reports_dir, "feature_importance.csv")
            else:
                feat_csv = os.path.join(reports_dir, "feature_importance.csv")
            if os.path.exists(feat_csv):
                import pandas as pd
                feat_df = pd.read_csv(feat_csv)
                importances = feat_df.head(10).to_dict(orient="records")
        except Exception as e:
            print(f"Error loading feature importance CSV: {e}")

        return {
            "real_time_metrics": summary,
            "model_metadata": metadata,
            "model_comparison": comparison,
            "feature_importance": importances
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
