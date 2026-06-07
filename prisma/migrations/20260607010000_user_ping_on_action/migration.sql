-- Per-user setting: when true, Discord announcements that reference the
-- player use a <@id> ping; default false uses the character name instead.
ALTER TABLE "User" ADD COLUMN "ping_on_action" BOOLEAN NOT NULL DEFAULT false;
