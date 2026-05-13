export const CELL_SIZE = 40;

// ASCII char → corpse color mapping (kept here so the loader is self-contained)
const ZOMBIE_COLOR_STR   = 'rgb(144,238,144)';
const CIVILIAN_COLOR_STR = 'rgb(80,80,80)';

// ── Native game-engine types returned by getLevel() ──────────────────────────

export interface WallCell {
  col: number;
  row: number;
}

export interface BeingSpawn {
  type: 'zombie' | 'human';
  x: number; // world-space px
  y: number;
}

export interface CorpseSpawn {
  x: number; // world-space px
  y: number;
  color: string;
}

export interface LevelData {
  /** World-space player start position, or null if the map has no 'P' tile. */
  playerStart: { x: number; y: number } | null;
  walls: WallCell[];
  beings: BeingSpawn[];
  corpses: CorpseSpawn[];
}

// ── Summary returned by getAllLevels() ────────────────────────────────────────

export interface LevelSummary {
  id: number;
  name: string;
  zombieCount: number;
  civilianCount: number;
}

// ── LevelLoader ───────────────────────────────────────────────────────────────

const NUM_LEVELS = 10;

export class LevelLoader {
  private rawMaps: string[][] = [];
  private summaries: LevelSummary[] = [];

  /** Fetch all level text files from the given base URL. */
  async load(base: string): Promise<void> {
    const texts = await Promise.all(
      Array.from({ length: NUM_LEVELS }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return fetch(`${base}levels/level${n}.txt`).then(r => {
          if (!r.ok) throw new Error(`Failed to load level${n}.txt: ${r.status}`);
          return r.text();
        });
      })
    );

    this.rawMaps = texts.map(t => t.split('\n').filter(line => line.length > 0));

    this.summaries = this.rawMaps.map((map, i) => {
      let zombieCount = 0, civilianCount = 0;
      for (const row of map) {
        for (const ch of row) {
          if (ch === 'Z') zombieCount++;
          else if (ch === 'C') civilianCount++;
        }
      }
      return { id: i + 1, name: `Level ${i + 1}`, zombieCount, civilianCount };
    });
  }

  /** Returns a summary of every available level (for the level-select screen). */
  getAllLevels(): LevelSummary[] {
    return this.summaries;
  }

  /**
   * Returns the full native representation of a level.
   * Walls stay as grid cells; beings, corpses, and player start are in world-space px.
   */
  getLevel(id: number): LevelData {
    const map = this.rawMaps[Math.min(id - 1, this.rawMaps.length - 1)];
    const walls: WallCell[] = [];
    const beings: BeingSpawn[] = [];
    const corpses: CorpseSpawn[] = [];
    let playerStart: { x: number; y: number } | null = null;

    for (let row = 0; row < map.length; row++) {
      const rowStr = map[row];
      for (let col = 0; col < rowStr.length; col++) {
        const ch = rowStr[col];
        const cx = col * CELL_SIZE + CELL_SIZE / 2;
        const cy = row * CELL_SIZE + CELL_SIZE / 2;
        switch (ch) {
          case 'W': walls.push({ col, row }); break;
          case 'Z': beings.push({ type: 'zombie', x: cx, y: cy }); break;
          case 'C': beings.push({ type: 'human',  x: cx, y: cy }); break;
          case 'z': corpses.push({ x: cx, y: cy, color: ZOMBIE_COLOR_STR });   break;
          case 'c': corpses.push({ x: cx, y: cy, color: CIVILIAN_COLOR_STR }); break;
          case 'P': playerStart = { x: cx, y: cy }; break;
        }
      }
    }

    return { playerStart, walls, beings, corpses };
  }
}
