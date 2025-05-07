# Builder stage
FROM python:3.11-slim-buster AS builder

WORKDIR /app

# Copy requirements and install dependencies
COPY scores_server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY scores_server /app/scores_server
COPY scores_html /app/scores_html

# Final stage
FROM python:3.11-slim-buster

RUN apt-get update && apt-get install -y supervisor --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder /app /app

# Copy supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose ports
EXPOSE 8000
EXPOSE 5005
EXPOSE 5000

# Command to start supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
