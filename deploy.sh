#!/bin/bash
set -e
exec 9>/tmp/idya-dev-deploy.lock
flock 9
cd /home/mac-admin/Idya
git fetch origin dev
git reset --hard origin/dev
npm install --include=dev
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart idya-dev
pm2 save
