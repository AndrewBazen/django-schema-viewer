#!/usr/bin/env python
"""Django management script for development/testing."""
import os
import sys

if __name__ == "__main__":
    # Add src to path for schema_viewer package
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "tests.settings")

    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
