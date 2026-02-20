FROM node:22-alpine AS web-build

WORKDIR /app/v2
COPY v2/package.json v2/tsconfig.json ./
COPY v2/scripts ./scripts
COPY v2/apps ./apps
RUN npm install && npm run build:web

FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY v2 /app/v2
COPY --from=web-build /app/v2/apps/control-panel/public/main.js /app/v2/apps/control-panel/public/main.js
COPY --from=web-build /app/v2/apps/control-panel/public/main.js.map /app/v2/apps/control-panel/public/main.js.map
COPY --from=web-build /app/v2/apps/commentator-hub/public/main.js /app/v2/apps/commentator-hub/public/main.js
COPY --from=web-build /app/v2/apps/commentator-hub/public/main.js.map /app/v2/apps/commentator-hub/public/main.js.map
COPY --from=web-build /app/v2/apps/obs-views/public/main.js /app/v2/apps/obs-views/public/main.js
COPY --from=web-build /app/v2/apps/obs-views/public/main.js.map /app/v2/apps/obs-views/public/main.js.map

RUN pip install --no-cache-dir -e /app/v2

EXPOSE 8100

CMD ["uvicorn", "v2.apps.api.main:app", "--host", "0.0.0.0", "--port", "8100"]
