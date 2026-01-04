"""Sample models demonstrating various Django model features."""

from django.db import models


class Author(models.Model):
    """An author who writes books."""

    name = models.CharField(max_length=100, help_text="Author's full name")
    email = models.EmailField(unique=True)
    bio = models.TextField(blank=True)
    birth_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["name"]),
        ]

    def __str__(self):
        return self.name


class Publisher(models.Model):
    """A book publisher."""

    name = models.CharField(max_length=200)
    website = models.URLField(blank=True)
    established = models.PositiveIntegerField(null=True, blank=True)

    def __str__(self):
        return self.name


class Category(models.Model):
    """Book category/genre."""

    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )

    class Meta:
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Book(models.Model):
    """A book with relationships to authors and publishers."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        OUT_OF_PRINT = "out_of_print", "Out of Print"

    title = models.CharField(max_length=300)
    isbn = models.CharField(max_length=13, unique=True, db_index=True)
    authors = models.ManyToManyField(Author, through="BookAuthor", related_name="books")
    publisher = models.ForeignKey(
        Publisher,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="books",
    )
    categories = models.ManyToManyField(Category, related_name="books", blank=True)
    publication_date = models.DateField(null=True, blank=True)
    page_count = models.PositiveIntegerField(null=True, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    summary = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-publication_date"]
        indexes = [
            models.Index(fields=["title"]),
            models.Index(fields=["publication_date"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(page_count__gte=1) | models.Q(page_count__isnull=True),
                name="valid_page_count",
            ),
        ]

    def __str__(self):
        return self.title


class BookAuthor(models.Model):
    """Through model for Book-Author M2M relationship."""

    class Role(models.TextChoices):
        AUTHOR = "author", "Author"
        CO_AUTHOR = "co_author", "Co-Author"
        EDITOR = "editor", "Editor"
        TRANSLATOR = "translator", "Translator"

    book = models.ForeignKey(Book, on_delete=models.CASCADE)
    author = models.ForeignKey(Author, on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.AUTHOR)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]
        unique_together = [("book", "author", "role")]

    def __str__(self):
        return f"{self.author} - {self.book} ({self.role})"


class Review(models.Model):
    """A book review."""

    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="reviews")
    reviewer_name = models.CharField(max_length=100)
    rating = models.PositiveSmallIntegerField()
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(rating__gte=1, rating__lte=5),
                name="valid_rating",
            ),
        ]

    def __str__(self):
        return f"Review of {self.book} by {self.reviewer_name}"


class BookDetail(models.Model):
    """One-to-one extension of Book with additional details."""

    book = models.OneToOneField(Book, on_delete=models.CASCADE, related_name="detail")
    full_description = models.TextField()
    table_of_contents = models.TextField(blank=True)
    sample_chapter = models.TextField(blank=True)

    def __str__(self):
        return f"Details for {self.book}"
