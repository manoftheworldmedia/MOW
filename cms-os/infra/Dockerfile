# MOW CMS OS — single-image deploy. Zero runtime deps, so no install step.
FROM node:22-alpine
WORKDIR /app

# Shared engine + backend + frontend (frontend & shared are served statically).
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
ENV PORT=4000
EXPOSE 4000

# Persist the operational stores (users/projects) on a mounted volume.
VOLUME ["/app/backend/data"]

CMD ["node", "server.js"]
