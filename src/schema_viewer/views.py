from django.apps import apps
from django.http import JsonResponse
from django.shortcuts import render
from django.db.models import Field
from django.db.models.fields.related import (
    ForeignKey,
    OneToOneField,
    ManyToManyField,
    ManyToOneRel,
    ManyToManyRel,
    OneToOneRel,
)


def index(request):
    """Render the main schema viewer interface."""
    return render(request, "schema_viewer/index.html")


def get_field_info(field: Field) -> dict:
    """Extract relevant information from a Django model field."""
    info = {
        "name": field.name,
        "type": field.get_internal_type(),
        "verbose_name": str(field.verbose_name) if hasattr(field, "verbose_name") else None,
        "help_text": str(field.help_text) if hasattr(field, "help_text") and field.help_text else None,
        "primary_key": getattr(field, "primary_key", False),
        "unique": getattr(field, "unique", False),
        "null": getattr(field, "null", False),
        "blank": getattr(field, "blank", False),
        "db_index": getattr(field, "db_index", False),
        "editable": getattr(field, "editable", True),
    }

    # Add default value if present
    if hasattr(field, "default") and field.default is not None:
        default = field.default
        if callable(default):
            info["default"] = f"<callable: {default.__name__}>"
        elif default != field.empty_strings_allowed:
            try:
                info["default"] = str(default)
            except Exception:
                info["default"] = "<complex default>"

    # Add choices if present
    if hasattr(field, "choices") and field.choices:
        info["choices"] = [
            {"value": choice[0], "label": str(choice[1])}
            for choice in field.choices
        ]

    # Add max_length for char fields
    if hasattr(field, "max_length") and field.max_length:
        info["max_length"] = field.max_length

    return info


def get_relationship_info(field) -> dict | None:
    """Extract relationship information from a relational field."""
    # Forward relations
    if isinstance(field, (ForeignKey, OneToOneField, ManyToManyField)):
        related_model = field.related_model
        rel_type = "many_to_many" if isinstance(field, ManyToManyField) else \
                   "one_to_one" if isinstance(field, OneToOneField) else "foreign_key"
        
        info = {
            "name": field.name,
            "type": rel_type,
            "direction": "forward",
            "target_app": related_model._meta.app_label,
            "target_model": related_model._meta.model_name,
            "related_name": field.remote_field.related_name or f"{field.model._meta.model_name}_set",
            "null": getattr(field, "null", False),
            "on_delete": str(field.remote_field.on_delete.__name__) if hasattr(field.remote_field, "on_delete") else None,
        }

        # Add through model for M2M
        if isinstance(field, ManyToManyField):
            through = field.remote_field.through
            if through and not through._meta.auto_created:
                info["through"] = {
                    "app": through._meta.app_label,
                    "model": through._meta.model_name,
                }

        return info

    # Reverse relations
    if isinstance(field, (ManyToOneRel, ManyToManyRel, OneToOneRel)):
        rel_type = "many_to_many" if isinstance(field, ManyToManyRel) else \
                   "one_to_one" if isinstance(field, OneToOneRel) else "foreign_key"
        
        return {
            "name": field.name or field.get_accessor_name(),
            "type": rel_type,
            "direction": "reverse",
            "target_app": field.related_model._meta.app_label,
            "target_model": field.related_model._meta.model_name,
            "field_name": field.field.name,
        }

    return None


def get_model_info(model, include_fields: bool = True) -> dict:
    """Extract comprehensive information about a Django model."""
    meta = model._meta

    info = {
        "app_label": meta.app_label,
        "model_name": meta.model_name,
        "verbose_name": str(meta.verbose_name),
        "verbose_name_plural": str(meta.verbose_name_plural),
        "db_table": meta.db_table,
        "abstract": meta.abstract,
        "proxy": meta.proxy,
        "managed": meta.managed,
        "app_config": apps.get_app_config(meta.app_label).verbose_name,
    }

    # Inheritance info
    if meta.parents:
        info["parents"] = [
            {"app": parent._meta.app_label, "model": parent._meta.model_name}
            for parent in meta.parents.keys()
        ]

    if include_fields:
        # Get all fields (excluding reverse relations for the basic list)
        fields = []
        relationships = []

        for field in meta.get_fields():
            rel_info = get_relationship_info(field)
            if rel_info:
                relationships.append(rel_info)
            elif hasattr(field, "get_internal_type"):
                fields.append(get_field_info(field))

        info["fields"] = fields
        info["relationships"] = relationships

        # Indexes
        if meta.indexes:
            info["indexes"] = [
                {
                    "name": index.name,
                    "fields": list(index.fields),
                }
                for index in meta.indexes
            ]

        # Unique constraints
        if meta.constraints:
            info["constraints"] = [
                {
                    "name": constraint.name,
                    "type": constraint.__class__.__name__,
                }
                for constraint in meta.constraints
            ]

        # Unique together (legacy)
        if meta.unique_together:
            info["unique_together"] = [list(ut) for ut in meta.unique_together]

    return info


def schema_api(request):
    """
    API endpoint that returns the full schema as JSON.
    
    Query parameters:
        - exclude_django: Exclude Django's built-in models (default: true)
        - apps: Comma-separated list of app labels to include
    """
    exclude_django = request.GET.get("exclude_django", "true").lower() == "true"
    include_apps = request.GET.get("apps", "").split(",") if request.GET.get("apps") else None

    django_apps = {"admin", "auth", "contenttypes", "sessions", "messages", "staticfiles"}

    schema = {"apps": {}}

    for model in apps.get_models():
        app_label = model._meta.app_label

        # Filter by app if specified
        if include_apps and app_label not in include_apps:
            continue

        # Exclude Django built-in apps if requested
        if exclude_django and app_label in django_apps:
            continue

        # Skip abstract models (they won't appear in get_models anyway, but just in case)
        if model._meta.abstract:
            continue

        # Initialize app in schema if needed
        if app_label not in schema["apps"]:
            app_config = apps.get_app_config(app_label)
            schema["apps"][app_label] = {
                "verbose_name": app_config.verbose_name,
                "models": {},
            }

        # Add model to schema (without full field details for overview)
        model_info = get_model_info(model, include_fields=True)
        schema["apps"][app_label]["models"][model._meta.model_name] = model_info

    return JsonResponse(schema)


def model_detail_api(request, app_label: str, model_name: str):
    """
    API endpoint for detailed information about a specific model.
    """
    try:
        model = apps.get_model(app_label, model_name)
    except LookupError:
        return JsonResponse({"error": "Model not found"}, status=404)

    info = get_model_info(model, include_fields=True)

    # Add additional details for the detail view
    meta = model._meta

    # Get model methods (excluding dunder methods and private methods)
    methods = []
    for name in dir(model):
        if name.startswith("_"):
            continue
        attr = getattr(model, name, None)
        if callable(attr) and not isinstance(attr, type):
            try:
                # Check if it's defined on this model, not inherited from Model
                if name in model.__dict__:
                    methods.append({"name": name})
            except Exception:
                pass

    if methods:
        info["methods"] = methods

    # Managers
    managers = [
        {"name": manager.name, "class": manager.__class__.__name__}
        for manager in meta.managers
    ]
    if managers:
        info["managers"] = managers

    return JsonResponse(info)
