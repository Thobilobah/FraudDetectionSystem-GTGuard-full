import os
import json
from fastapi import APIRouter, HTTPException
from backend.app.config import settings
from backend.app.repositories.transaction_repository import db_repo

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
                
        # Load feature importance
        importances = []
        feat_csv = os.path.join(reports_dir, "feature_importance.csv")
        if os.path.exists(feat_csv):
            import pandas as pd
            try:
                feat_df = pd.read_csv(feat_csv)
                # Keep top 10
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
