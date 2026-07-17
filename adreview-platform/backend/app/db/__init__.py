"""DB package init - ensure all models register on Base.metadata."""
from app.db.session import Base  # noqa: F401

# Import the models package once so its __init__ eagerly imports every ORM model.
import app.models  # noqa: F401
