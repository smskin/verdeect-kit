FROM node:24-alpine AS dev
CMD ["sh", "-c", "pnpm build && node --watch --import ./dist/instrument.js dist/main.js"]

FROM node:24-alpine AS prod
CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]
