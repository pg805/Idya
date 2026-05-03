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
  guild_id: string;
  admins:   string[];
  channels: {
    town_square:    string;
    blacksmith:     string;
    general_store:  string;
    forest:         string;
    temple:         string;
    enchanting_shop: string;
  };
  npcs: {
    mayor:         NpcDef;
    general_store: NpcDef;
    blacksmith:    NpcDef;
    temple:        NpcDef;
    enchanting:    NpcDef;
    carpenter:     NpcDef;
  };
}

const worldConfig: WorldConfig = JSON.parse(
  fs.readFileSync(join(__dirname, '../../database/world.json'), 'utf-8')
);

export default worldConfig;
