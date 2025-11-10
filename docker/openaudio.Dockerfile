# Pin to a specific version for stability and reproducibility
# Update this version tag as needed from: https://hub.docker.com/r/fishaudio/fish-speech/tags
# Available tags: latest, latest-dev, server-cuda, server-cuda-nightly
# Note: Use server-cuda tag for API server support
FROM fishaudio/fish-speech:server-cuda

# Create working directory
WORKDIR /app

# Install missing Python dependencies required by api_server.py
# The base image has externally-managed Python, so use --break-system-packages
RUN pip install --no-cache-dir --break-system-packages \
    pyrootutils \
    uvicorn \
    fastapi \
    kui \
    loguru \
    tyro \
    pydantic \
    ormsgpack

# Copy checkpoints from the backend directory
# Note: Build context is backend directory, so path is openaudio-checkpoints/
COPY openaudio-checkpoints/ /app/checkpoints/OpenAudio-S1-mini/

# Set environment variables for fish-speech API server
ENV LLAMA_CHECKPOINT_PATH=checkpoints/OpenAudio-S1-mini
ENV DECODER_CHECKPOINT_PATH=checkpoints/OpenAudio-S1-mini/codec.pth
ENV DECODER_CONFIG_NAME=modded_dac_vq
ENV COMPILE=1

# Expose the API port
EXPOSE 8080

# Clear the default entrypoint from base image to run API server directly
ENTRYPOINT []

# Start the API server
CMD ["python3", "-m", "tools.api_server", \
     "--listen", "0.0.0.0:8080", \
     "--llama-checkpoint-path", "checkpoints/OpenAudio-S1-mini", \
     "--decoder-checkpoint-path", "checkpoints/OpenAudio-S1-mini/codec.pth", \
     "--decoder-config-name", "modded_dac_vq", \
     "--compile"]
