FROM fishaudio/fish-speech:latest-dev

# Install git and git-lfs for checkpoint management
RUN apt-get update && apt-get install -y git git-lfs && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

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

# Start the API server
CMD ["python", "-m", "tools.api_server", \
     "--listen", "0.0.0.0:8080", \
     "--llama-checkpoint-path", "checkpoints/OpenAudio-S1-mini", \
     "--decoder-checkpoint-path", "checkpoints/OpenAudio-S1-mini/codec.pth", \
     "--decoder-config-name", "modded_dac_vq", \
     "--compile"]
