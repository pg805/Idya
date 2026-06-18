import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface NpcDef {
  name:  string;
  title: string;
}

export interface WorldConfig {
  guild_id:   string;
  sprite_cdn: string;
  admin_role: string;
  join_role?: string;   // role auto-granted to members on join (per guild; optional)
  dev: string[];
  channels: {
    welcome:        string;
    rules:          string;
    town_square:    string;
    blacksmith:     string;
    general_store:  string;
    forest:         string;
    temple:         string;
    enchanting_shop: string;
    lumberjack:     string;
    ooc:            string;
    bot_log?:       string;
    updates?:       string;
  };
  npcs: {
    mayor:         NpcDef;
    general_store: NpcDef;
    blacksmith:    NpcDef;
    lumberjack:    NpcDef;
    temple:        NpcDef;
    enchanting:    NpcDef;
  };
}

const raw = JSON.parse(
  fs.readFileSync(join(__dirname, '../../database/world.json'), 'utf-8')
);

const env = process.env.NODE_ENV === 'production' ? raw.prod : raw.dev;

const worldConfig: WorldConfig = {
  ...raw.shared,
  ...env,
};

export default worldConfig;
