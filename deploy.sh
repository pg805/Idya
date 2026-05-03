#!/bin/bash
cd /home/mac-admin/Idya
git pull origin dev
npm install --include=dev
npx prisma generate
npm run build
pm2 delete idya-dev 2>/dev/null; pm2 start ecosystem.config.cjs && pm2 save
