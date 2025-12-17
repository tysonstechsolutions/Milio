# Railway Dockerfile for Milio Backend
FROM python:3.11-slim

# Install system dependencies (ffmpeg for Whisper)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir .

# Copy application code
COPY app/ ./app/

# Copy Alembic files for migrations
COPY alembic.ini ./
COPY alembic/ ./alembic/

# Expose port (Railway sets PORT env var)
EXPOSE 8000

# Run migrations and start the server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
