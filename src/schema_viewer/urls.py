from django.urls import path

from . import views

app_name = "schema_viewer"

urlpatterns = [
    path("", views.index, name="index"),
    path("api/schema/", views.schema_api, name="schema_api"),
    path("api/model/<str:app_label>/<str:model_name>/", views.model_detail_api, name="model_detail_api"),
]
