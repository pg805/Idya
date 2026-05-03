#!/bin/bash
cd /home/mac-admin/Idya
git pull origin dev
npm install --include=dev
npx prisma generate
npm run build
pm2 restart idya-dev --update-env
