"""DB package init - ensure models are registered with metadata before create_all/alembic."""
from app.db.session import Base  # noqa: F401

# Import all model modules so SQLAlchemy registers them on Base.metadata.
import app.models.user  # noqa: F401
import app.models.material  # noqa: F401
import app.models.review  # noqa: F401
import app.models.annotation  # noqa: F401
import app.models.workflow  # noqa: F401
import app.models.audit  # noqa: F401
import app.models.strategy  # noqa: F401
import app.models.service_category  # noqa: F401
import app.models.service  # noqa: F401
import app.models.material_package  # noqa: F401
