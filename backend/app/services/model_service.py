import os
import json
from backend.app.config import settings

class ModelService:
    @staticmethod
    def get_model_metadata() -> dict | None:
        """
        Retrieves the compiled model pipeline's metadata.
        """
        metadata_path = os.path.abspath(settings.METADATA_PATH)
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error reading model metadata: {e}")
        return None

    @staticmethod
    def is_model_available() -> bool:
        """
        Checks if the serialized pickle file exists.
        """
        return os.path.exists(os.path.abspath(settings.MODEL_PATH))

model_service = ModelService()
