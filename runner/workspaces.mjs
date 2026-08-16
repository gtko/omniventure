/**
 * Un dépôt par projet, hors de l'usine.
 *
 * Le pont ne connaissait qu'une seule racine : celle d'OmniVenture. Quand un
 * agent écrivait le code d'un produit, il l'écrivait donc **dans le dépôt de
 * l'agence** — mélangé à son historique git, à ses commits, à ses branches.
 * C'est faux à deux titres : un produit a sa propre vie et son propre dépôt, et
 * l'usine ne doit pas grossir de tout ce qu'elle fabrique.
 *
 * Chaque projet a désormais son dossier, à côté de l'usine et non dedans, avec
 * son propre git. L'agence garde le sien pour son auto-amélioration.
 *
 *   …/factoryWebsite            ← l'usine (espace « agence »)
 *   …/omniventure-ventures/
 *       pricewatch/             ← un projet, son git à lui
 *       autre-produit/
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** L'espace de l'agence : le dépôt d'OmniVenture lui-même. */
export const AGENCY = 'agence';

/**
 * Où vivent les projets. Par défaut à côté de l'usine — jamais dedans, sinon
 * on retombe exactement sur le problème qu'on corrige.
 */
export function venturesRoot(projectRoot) {
  const configured = process.env.OMNIVENTURE_VENTURES;
  if (configured) return resolve(configured);
  return join(dirname(resolve(projectRoot)), 'omniventure-ventures');
}

/** Un slug ne doit pas pouvoir remonter l'arborescence. */
const cleanSlug = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/**
 * Racine de travail pour un espace donné.
 *
 * `agence` (ou rien) renvoie l'usine. Tout autre nom désigne un projet : son
 * dossier est créé au besoin, et doté d'un dépôt git à lui.
 */
export function rootFor(workspace, projectRoot) {
  const slug = cleanSlug(workspace);
  if (!slug || slug === AGENCY) return resolve(projectRoot);

  const target = join(venturesRoot(projectRoot), slug);
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
    seed(target, slug);
  }
  return target;
}

/** Premier pas d'un projet : un dépôt, un README, un .gitignore. */
function seed(target, slug) {
  writeFileSync(
    join(target, 'README.md'),
    `# ${slug}\n\nProduit fabriqué par l'agence OmniVenture.\nCe dépôt lui appartient : il ne partage rien avec celui de l'usine.\n`,
    'utf8'
  );
  writeFileSync(join(target, '.gitignore'), 'node_modules/\ndist/\n.env\n.omniventure/\n', 'utf8');

  // git absent ou en échec : le dossier reste utilisable, il n'est juste pas
  // versionné. On ne bloque pas la fabrication pour ça.
  //
  // Sans shell : le message de commit contient une espace, et le shell Windows
  // le coupait en deux — le dépôt restait alors sans commit initial.
  const git = (args) => spawnSync('git', args, { cwd: target, stdio: 'ignore', shell: false });

  if (git(['init', '-b', 'main']).status !== 0) return;
  git(['add', '.']);
  git(['commit', '-m', `init: ${slug}`]);
}

/** Espaces existants : l'agence, puis les projets déjà ouverts. */
export function listWorkspaces(projectRoot) {
  const spaces = [{ slug: AGENCY, label: "L'usine OmniVenture", root: resolve(projectRoot), git: true }];
  const base = venturesRoot(projectRoot);
  if (!existsSync(base)) return spaces;

  for (const name of readdirSync(base)) {
    const full = join(base, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    spaces.push({ slug: name, label: basename(full), root: full, git: existsSync(join(full, '.git')) });
  }
  return spaces;
}
