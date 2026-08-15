import { CATALOG } from './catalog';
import { buildNav, findPath, isWalkable } from './grid';
import { buildOffice, COLS, ROWS } from './layout';
import { TileType } from './types';

const { map, seats, spots, blocked, zones } = buildOffice();
const nav = buildNav(map, [...seats, ...spots], blocked);

/* ── Carte ASCII ────────────────────────────────────────────── */
const glyph: string[][] = [];
for (let r = 0; r < ROWS; r++) {
  const row: string[] = [];
  for (let c = 0; c < COLS; c++) {
    const t = map.tiles[r * COLS + c];
    if (t === TileType.VOID) row.push(' ');
    else if (t === TileType.WALL) row.push('#');
    else row.push(isWalkable(nav, c, r) ? '.' : 'x');
  }
  glyph.push(row);
}
for (const s of seats) glyph[s.row][s.col] = 'D';
for (const s of spots) if (glyph[s.row][s.col] !== 'D') glyph[s.row][s.col] = 'o';

console.log('    ' + Array.from({ length: COLS }, (_, i) => String(i % 10)).join(''));
glyph.forEach((row, i) => console.log(String(i).padStart(3) + ' ' + row.join('')));

/* ── Contrôles ──────────────────────────────────────────────── */
const problems: string[] = [];
const solidOwner = new Map<string, string>();

for (const item of map.furniture) {
  const e = CATALOG[item.type];
  if (!e) {
    problems.push(`Asset inconnu : ${item.type}`);
    continue;
  }
  if (item.col < 0 || item.row < 0 || item.col + e.fw > COLS || item.row + e.fh > ROWS) {
    problems.push(`Hors carte : ${item.type} (${item.col},${item.row})`);
  }
  for (let dr = e.bg; dr < e.fh; dr++) {
    for (let dc = 0; dc < e.fw; dc++) {
      const key = `${item.col + dc},${item.row + dr}`;
      const prev = solidOwner.get(key);
      if (prev && !e.surface && !CATALOG[prev]?.surface) {
        problems.push(`Collision ${item.type}(${item.col},${item.row}) <-> ${prev} sur ${key}`);
      }
      solidOwner.set(key, item.type);
    }
  }
}

const start = seats[0];
let unreachable = 0;
const targets = [
  ...seats.map((s) => ({ name: `seat:${s.id}`, col: s.col, row: s.row })),
  ...spots.map((s) => ({ name: `spot:${s.id}`, col: s.col, row: s.row }))
];
for (const t of targets) {
  if (t.col === start.col && t.row === start.row) continue;
  if (findPath(nav, start, t).length === 0) {
    unreachable++;
    if (unreachable <= 12) problems.push(`INATTEIGNABLE : ${t.name} (${t.col},${t.row})`);
  }
}
if (unreachable > 12) problems.push(`… et ${unreachable - 12} autres cibles inatteignables`);

const seen = new Set<string>();
let duplicates = 0;
for (const s of [...seats, ...spots]) {
  const k = `${s.col},${s.row}`;
  if (seen.has(k)) duplicates++;
  seen.add(k);
}
if (duplicates > 0) problems.push(`${duplicates} places superposées`);

const spotsByKind: Record<string, number> = {};
for (const s of spots) spotsByKind[s.kind] = (spotsByKind[s.kind] ?? 0) + 1;

const seatsByRoom: Record<string, number> = {};
for (const s of seats) seatsByRoom[s.room] = (seatsByRoom[s.room] ?? 0) + 1;

console.log('\nCarte :', COLS, 'x', ROWS, '=>', COLS * 16, 'x', ROWS * 16, 'px');
console.log('Zones :', zones.length, '| meubles :', map.furniture.length, '| tampons :', blocked.length);
console.log('Postes :', seats.length, seatsByRoom);
console.log('Spots  :', spots.length, spotsByKind);
console.log(problems.length === 0 ? '\nOK — aucun problème détecté.' : '\nPROBLÈMES :\n' + problems.join('\n'));
