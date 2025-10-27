# Stage 1: Builder
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install Python and build essentials
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3.11 python3-pip python3.11-venv git cmake ninja-build \
    ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

# Create and activate a virtual environment
RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Install llama-cpp-python with prebuilt CUDA wheel (much faster than building from source)
RUN pip install --no-cache-dir llama-cpp-python \
    --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124

# Install dependencies from requirements.txt (excluding llama-cpp-python since we already installed it)
COPY requirements.txt .
RUN grep -v "llama-cpp-python" requirements.txt > requirements_filtered.txt && \
    pip install --no-cache-dir -r requirements_filtered.txt

# Install CUDA libraries for Faster-Whisper GPU acceleration
# These are required for CTranslate2 to use GPU inference
RUN pip install --no-cache-dir nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*

# ==================================================================
# Stage 2: Final Runtime Stage
# ==================================================================
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Python runtime and audio dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv \
    ffmpeg libsndfile1 curl && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
ARG UID=1000
ARG GID=1000
RUN groupadd -g $GID appuser && useradd --create-home --no-log-init -u $UID -g $GID appuser
WORKDIR /home/appuser

# Copy the virtual environment from the builder stage
COPY --from=builder /opt/venv /opt/venv

# Copy application code (keep the 'app' directory structure)
COPY --chown=appuser:appuser ./app ./app

USER appuser

# Set the PATH to use the Python from our virtual environment
ENV PATH="/opt/venv/bin:$PATH"

# Set LD_LIBRARY_PATH for CUDA libraries (required by CTranslate2)
ENV LD_LIBRARY_PATH="/opt/venv/lib/python3.11/site-packages/nvidia/cublas/lib:/opt/venv/lib/python3.11/site-packages/nvidia/cudnn/lib:${LD_LIBRARY_PATH}"

EXPOSE 6666

# Command to run your application (app.main:app refers to app/main.py)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6666"]