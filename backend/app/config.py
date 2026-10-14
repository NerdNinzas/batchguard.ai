from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    app_url: str = "http://localhost:3000"
    auth_secret: str = "dev-secret-change-me"
    database_path: str = "../data/batchguard.db"
    upload_dir: str = "../data/uploads"

    firebase_project_id: str = ""

    google_api_key: str = ""
    google_genai_use_vertexai: bool = False
    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"
    gemini_model_fast: str = "gemini-2.5-flash"
    gemini_model_pro: str = "gemini-2.5-pro"

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from: str = "BatchGuard AI <alerts@example.com>"

    stale_after_seconds: int = 10
    incident_cooldown_seconds: int = 300
    escalation_timeout_seconds: int = 120
    trend_window_seconds: int = 60
    demo_mode: bool = True

    @property
    def db_file(self) -> Path:
        return (BASE_DIR / self.database_path).resolve()

    @property
    def upload_path(self) -> Path:
        return (BASE_DIR / self.upload_dir).resolve()

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.google_api_key) or (self.google_genai_use_vertexai and bool(self.google_cloud_project))

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_user)


settings = Settings()
