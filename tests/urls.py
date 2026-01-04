from django.urls import path, include

urlpatterns = [
    path("__schema/", include("schema_viewer.urls")),
]
