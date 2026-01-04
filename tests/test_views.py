"""Tests for django-schema-viewer."""

import pytest
from django.test import Client


@pytest.fixture
def client():
    return Client()


@pytest.mark.django_db
class TestSchemaAPI:
    """Tests for the schema API endpoint."""

    def test_schema_api_returns_json(self, client):
        """Test that the schema API returns valid JSON."""
        response = client.get("/__schema/api/schema/")
        assert response.status_code == 200
        assert response["Content-Type"] == "application/json"

    def test_schema_api_contains_apps(self, client):
        """Test that the schema API returns app structure."""
        response = client.get("/__schema/api/schema/")
        data = response.json()
        assert "apps" in data
        assert isinstance(data["apps"], dict)

    def test_schema_api_excludes_django_by_default(self, client):
        """Test that Django built-in apps are excluded by default."""
        response = client.get("/__schema/api/schema/")
        data = response.json()
        assert "auth" not in data["apps"]
        assert "contenttypes" not in data["apps"]

    def test_schema_api_includes_django_when_requested(self, client):
        """Test that Django built-in apps can be included."""
        response = client.get("/__schema/api/schema/?exclude_django=false")
        data = response.json()
        assert "auth" in data["apps"]

    def test_schema_api_includes_sample_app(self, client):
        """Test that our sample app is included."""
        response = client.get("/__schema/api/schema/")
        data = response.json()
        assert "sample_app" in data["apps"]

    def test_schema_api_includes_model_fields(self, client):
        """Test that model fields are included."""
        response = client.get("/__schema/api/schema/")
        data = response.json()
        book_model = data["apps"]["sample_app"]["models"]["book"]
        assert "fields" in book_model
        field_names = [f["name"] for f in book_model["fields"]]
        assert "title" in field_names
        assert "isbn" in field_names

    def test_schema_api_includes_relationships(self, client):
        """Test that relationships are included."""
        response = client.get("/__schema/api/schema/")
        data = response.json()
        book_model = data["apps"]["sample_app"]["models"]["book"]
        assert "relationships" in book_model
        rel_names = [r["name"] for r in book_model["relationships"]]
        assert "publisher" in rel_names
        assert "authors" in rel_names


@pytest.mark.django_db
class TestModelDetailAPI:
    """Tests for the model detail API endpoint."""

    def test_model_detail_returns_json(self, client):
        """Test that the model detail API returns valid JSON."""
        response = client.get("/__schema/api/model/sample_app/book/")
        assert response.status_code == 200
        assert response["Content-Type"] == "application/json"

    def test_model_detail_returns_404_for_invalid_model(self, client):
        """Test that invalid models return 404."""
        response = client.get("/__schema/api/model/sample_app/nonexistent/")
        assert response.status_code == 404

    def test_model_detail_includes_meta_info(self, client):
        """Test that model meta information is included."""
        response = client.get("/__schema/api/model/sample_app/book/")
        data = response.json()
        assert data["db_table"] == "sample_app_book"
        assert data["verbose_name"] == "book"

    def test_model_detail_includes_indexes(self, client):
        """Test that indexes are included."""
        response = client.get("/__schema/api/model/sample_app/book/")
        data = response.json()
        assert "indexes" in data
        assert len(data["indexes"]) > 0


@pytest.mark.django_db
class TestIndexView:
    """Tests for the main index view."""

    def test_index_returns_html(self, client):
        """Test that the index view returns HTML."""
        response = client.get("/__schema/")
        assert response.status_code == 200
        assert "text/html" in response["Content-Type"]

    def test_index_contains_app_name(self, client):
        """Test that the index contains the app name."""
        response = client.get("/__schema/")
        assert b"Schema Viewer" in response.content
