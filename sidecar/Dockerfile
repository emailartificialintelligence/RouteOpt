# syntax=docker/dockerfile:1

# OR-Tools ships manylinux wheels, so a slim Debian base installs it without a
# compiler. Alpine would need to build from source — musl has no wheels.
FROM python:3.12-slim

WORKDIR /app

# Pinned: this engine decides delivery routes, and a solver quietly changing its
# search behaviour between deploys is not something you want to debug from a
# driver's phone call.
RUN pip install --no-cache-dir "ortools==9.15.6755"

COPY solver.py ./

# Inside the container network it must accept connections from the app service,
# so it binds to all interfaces here. It is NOT published to the host in
# docker-compose.yml — nothing outside the compose network can reach it.
ENV ORTOOLS_HOST=0.0.0.0
ENV ORTOOLS_PORT=8081

RUN useradd --create-home --uid 1001 solver
USER solver

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8081/health',timeout=4).status==200 else 1)"

CMD ["python", "solver.py"]
