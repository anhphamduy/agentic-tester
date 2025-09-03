# syntax=docker/dockerfile:1

FROM ghcr.io/astral-sh/uv:python3.12-bookworm

WORKDIR /app

# Keep Python output unbuffered and avoid .pyc files
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7111

# Copy project metadata first to leverage Docker layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies into a local virtualenv managed by uv
RUN uv sync --frozen --no-dev

# Ensure the venv is on PATH
ENV PATH="/app/.venv/bin:${PATH}"

# Copy application source
COPY app ./app
COPY main.py ./main.py

# FastAPI listens on 7111 (see app/main/api)
EXPOSE 7111

# Start the API server
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "7111"]


