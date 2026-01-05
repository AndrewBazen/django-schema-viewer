"""Pytest configuration for django-schema-viewer."""

import sys
from pathlib import Path

# Add project root and src directory to Python path
root = Path(__file__).parent
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "src"))
