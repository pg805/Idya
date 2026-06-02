#!/bin/bash
set -e
exec 9>/tmp/idya-prod-deploy.lock
flock 9
# Webhook process loads its own .env (dotenv/config) which leaks DATABASE_URL
# into spawned shells. Unset it so Prisma reads the repo's .env from disk.
unset DATABASE_URL
cd /home/mac-admin/Idya-prod
git fetch origin main
git reset --hard origin/main
npm install --include=dev
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart idya-prod
pm2 save
