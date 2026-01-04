# Django Schema Viewer

An interactive visualization tool for understanding Django model relationships.

## Features

- Visual graph of all models and their relationships
- Group models by Django app
- Filter and search models
- View field details, indexes, and constraints
- Trace query paths between models
- Highlight reverse relations

## Installation

```bash
pip install django-schema-viewer
```

## Quick Start

1. Add to your installed apps (development only):

```python
# settings.py
if DEBUG:
    INSTALLED_APPS += ["schema_viewer"]
```

2. Include the URLs:

```python
# urls.py
from django.conf import settings

if settings.DEBUG:
    urlpatterns += [
        path("__schema/", include("schema_viewer.urls")),
    ]
```

3. Run your development server and visit `http://localhost:8000/__schema/`

## Development

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/django-schema-viewer.git
cd django-schema-viewer

# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest
```

## License

MIT
