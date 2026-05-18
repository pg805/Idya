#!/bin/bash
set -e
cd /home/mac-admin/Idya
git pull origin dev
npm install --include=dev
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart idya-dev
pm2 save
