import { loadGraphProfiles } from './agents';
import { buildNav, isWalkable } from './grid';
import { buildOffice } from './layout';
import { OfficeSim } from './simulation';

// Le module d'agents lit localStorage : on le simule pour ce test Node.
(globalThis as any).localStorage = { getItem: () => null, setItem: () => undefined };

const { map, seats, spots, blocked } = buildOffice();
const nav = buildNav(map, [...seats, ...spots], blocked);
const profiles = loadGraphProfiles();
const sim = new OfficeSim(map, nav, profiles, seats, spots);

console.log(`Agents du graphe : ${profiles.length} sur ${seats.length} postes`);
console.log(profiles.map((p) => `${p.short} (${p.room})`).join(', '));

const dt = 1 / 30;
const HOURS = 8;
const steps = Math.round((HOURS * 3600) / dt);

const modeSeen = new Map<string, number>();
const activitySeen = new Map<string, number>();
let offGrid = 0;
let maxReserved = 0;
let frames = 0;

for (let i = 0; i < steps; i++) {
  sim.update(dt);
  maxReserved = Math.max(maxReserved, sim.reservedCount);
  for (const actor of sim.actors) {
    frames++;
    modeSeen.set(actor.mode, (modeSeen.get(actor.mode) ?? 0) + 1);
    if (actor.mode === 'activity') activitySeen.set(actor.activity, (activitySeen.get(actor.activity) ?? 0) + 1);
    if (!isWalkable(nav, actor.col, actor.row)) offGrid++;
  }
}

const pct = (n: number) => `${((n / frames) * 100).toFixed(1)} %`;
console.log(`\n=== ${HOURS} h de journée simulée ===`);
console.log('Temps par mode :', Object.fromEntries([...modeSeen].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v)])));
console.log('Temps par activité :', Object.fromEntries([...activitySeen].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, pct(v)])));
console.log('Positions hors grille :', offGrid, '| réservations max :', maxReserved, '(plafond :', profiles.length, ')');

console.log('\n--- Journal de la journée ---');
for (const event of sim.events.slice(0, 14)) console.log(` ${event.tone === 'real' ? '⚡' : '·'} ${event.text}`);

console.log('\n--- État final ---');
for (const actor of sim.actors) {
  console.log(` ${actor.profile.short.padEnd(10)} ${String(actor.mode).padEnd(9)} (${actor.col},${actor.row})  ${sim.statusOf(actor)}`);
}

/* Persistance : on sauvegarde, on recrée un bureau vierge, on restaure. */
const snapshot = sim.snapshot();
const fresh = new OfficeSim(map, nav, profiles, seats, spots);
const restored = fresh.restore(snapshot);
const same = fresh.actors.every((actor) => {
  const saved = snapshot.actors.find((s) => s.id === actor.profile.id);
  return saved && saved.col === actor.col && saved.row === actor.row;
});
console.log('\nReprise :', restored, 'agents replacés | positions identiques :', same);

/* Tâche réelle. */
const from = profiles[2].id;
const to = profiles[0].id;
fresh.triggerRealTask(from, to, '🕷️ Crawl terminé', 'Inspection de loom.com');
const mover = fresh.byId.get(from)!;
console.log('Tâche réelle :', mover.profile.short, '→', fresh.byId.get(to)!.profile.short, '| trajet :', mover.path.length, 'cases');
