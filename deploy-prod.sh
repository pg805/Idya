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

# Purge Cloudflare cache so users don't get served stale 404s (or stale
# HTML referencing files that didn't exist mid-deploy) from the CF edge.
# Token + zone ID live in this repo's .env. We grep instead of `source`
# so we don't re-leak DATABASE_URL into the shell environment.
CF_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
CF_ZONE=$(grep  '^CLOUDFLARE_ZONE_ID='   .env 2>/dev/null | cut -d= -f2-)
if [ -n "$CF_TOKEN" ] && [ -n "$CF_ZONE" ]; then
  if curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/purge_cache" \
       -H "Authorization: Bearer $CF_TOKEN" \
       -H "Content-Type: application/json" \
       --data '{"purge_everything":true}' >/dev/null; then
    echo "Cloudflare cache purged."
  else
    echo "Cloudflare purge failed (deploy still succeeded)."
  fi
else
  echo "Cloudflare purge skipped (CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not set)."
fi
