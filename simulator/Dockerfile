FROM python:3.11-slim

WORKDIR /app

# Install simulator dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy simulator code
COPY simulator.py ./

ENV BROKER_HOST=mosquitto
ENV BROKER_PORT=1883

CMD ["python", "simulator.py"]
