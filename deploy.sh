#!/bin/bash
set -e
exec 9>/tmp/idya-dev-deploy.lock
flock 9
# Webhook process loads its own .env (dotenv/config) which leaks DATABASE_URL
# into spawned shells. Unset it so Prisma reads the repo's .env from disk.
unset DATABASE_URL
cd /home/mac-admin/Idya
git fetch origin dev
git reset --hard origin/dev
npm install --include=dev
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart idya-dev
git diff HEAD@{1} HEAD -- webhook/index.js | grep -q . && pm2 reload webhook || true
pm2 save
