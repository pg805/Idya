#!/bin/bash
set -e
exec 9>/tmp/idya-prod-deploy.lock
flock 9
cd /home/mac-admin/Idya-prod
git pull origin main
npm install --include=dev
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart idya-prod
pm2 save
