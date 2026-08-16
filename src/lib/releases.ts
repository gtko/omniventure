/**
 * Les versions d'un produit.
 *
 * Le chantier livrait en continu : des tâches passaient en revue, du code
 * atterrissait dans le dépôt, et rien ne marquait jamais « voilà ce qui est
 * sorti ». Six semaines plus tard, impossible de dire ce que contenait la mise
 * en ligne du mardi, ni quel ticket elle réglait.
 *
 * Une version rassemble trois choses qui existent déjà séparément et qu'on ne
 * rapprochait pas :
 *
 *   - les **commits** du dépôt du produit depuis la version précédente,
 *   - les **tickets** livrés dans le même intervalle,
 *   - un **journal des modifications** écrit à partir des deux, par un agent.
 *
 * Les commits sont lus dans le dépôt réel, pas déduits : c'est la seule source
 * qui ne ment pas sur ce qui a changé.
 */

import { record } from './agent-ledger';
import { runAgent } from './agent-sdk';
import { cultureBlock, readCulture } from './culture';
import { getRunnerToken, RUNNER_URL } from './harness-client';
import { readGraph, type GraphAgent } from './hiring';
import { readTasks, upsertDoc, type Task } from './workspace';
import { readLocal, writeLocal } from './local';

export interface Commit {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

export interface ReleaseTicket {
  id: string;
  title: string;
  phase?: string;
  sprint?: number;
}

export interface Release {
  id: string;
  ventureName: string;
  version: string;
  /** Titre court : ce que cette version apporte, en une ligne. */
  headline: string;
  /** Journal des modifications, en markdown. */
  changelog: string;
  commits: Commit[];
  tickets: ReleaseTicket[];
  /** Commit de départ : sert à ne pas recompter les mêmes changements. */
  sinceHash: string | null;
  headHash: string | null;
  at: number;
  /** Étiquette posée dans le dépôt du produit, quand git l'a acceptée. */
  tagged: boolean;
}

const STORE_KEY = 'omniventure_releases_v1';
export const RELEASES_EVENT = 'omniventure_releases_updated';

export function readReleases(): Release[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = readLocal(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReleases(releases: Release[]): void {
  try {
    writeLocal(STORE_KEY, JSON.stringify(releases.slice(0, 200)));
  } catch {
    /* stockage plein */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RELEASES_EVENT));
}

export const releasesOf = (ventureName: string): Release[] =>
  readReleases()
    .filter((release) => release.ventureName === ventureName)
    .sort((a, b) => b.at - a.at);

/* ------------------------------------------------------------------ */
/* Ce qui a changé                                                     */
/* ------------------------------------------------------------------ */

/** Appel au pont, sur le dépôt du produit. */
async function bridge(tool: string, args: Record<string, unknown>, workspace: string, autonomy = 'read') {
  const token = getRunnerToken();
  const res = await fetch(`${RUNNER_URL}/tools/call`, {
    method: 'POST',
    headers: token
      ? { 'Content-Type': 'application/json', 'X-Omniventure-Token': token }
      : { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args, autonomy, workspace })
  });
  return (await res.json()) as { result?: any; error?: string };
}

/**
 * Les commits depuis une référence.
 *
 * Format volontairement séparé par des caractères improbables : un sujet de
 * commit contient des espaces, des tirets et parfois des barres verticales, et
 * une découpe naïve casserait au premier message un peu bavard.
 */
export async function commitsSince(workspace: string, since: string | null): Promise<Commit[]> {
  const range = since ? `${since}..HEAD` : 'HEAD';
  const response = await bridge(
    'git',
    { args: ['log', range, '--pretty=format:%h%x1f%ad%x1f%an%x1f%s', '--date=short', '-n', '200'] },
    workspace
  );

  if (response.error || !response.result?.ok) return [];

  // Separateur d'unites (U+001F) : il ne peut pas apparaitre dans un message
  // de commit, contrairement au point-virgule ou a la barre verticale.
  const SEPARATEUR = String.fromCharCode(31);
  return String(response.result.stdout ?? '')
    .split('\n')
    .map((line) => line.split(SEPARATEUR))
    .filter((parts) => parts.length === 4)
    .map(([hash, date, author, subject]) => ({ hash, date, author, subject }));
}

async function head(workspace: string): Promise<string | null> {
  const response = await bridge('git', { args: ['rev-parse', '--short', 'HEAD'] }, workspace);
  const value = String(response.result?.stdout ?? '').trim();
  return value && response.result?.ok ? value : null;
}

/** Les tickets livrés depuis la version précédente. */
export function ticketsSince(ventureName: string, since: number): ReleaseTicket[] {
  return readTasks()
    .filter(
      (task: Task) =>
        task.source === ventureName &&
        (task.status === 'done' || task.status === 'review') &&
        task.updatedAt > since
    )
    .map((task) => ({ id: task.id, title: task.title, phase: task.phase, sprint: task.sprint }));
}

/** Numéro de version suivant. Mineur par défaut, majeur sur demande. */
export function nextVersion(ventureName: string, kind: 'majeure' | 'mineure' | 'corrective' = 'mineure'): string {
  const previous = releasesOf(ventureName)[0];
  const [major, minor, patch] = (previous?.version ?? '0.0.0').split('.').map((part) => Number(part) || 0);

  if (kind === 'majeure') return `${major + 1}.0.0`;
  if (kind === 'corrective') return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor + 1}.0`;
}

/* ------------------------------------------------------------------ */
/* Préparer, puis publier                                              */
/* ------------------------------------------------------------------ */

export interface ReleaseDraft {
  version: string;
  commits: Commit[];
  tickets: ReleaseTicket[];
  sinceHash: string | null;
  headHash: string | null;
  since: number;
}

/** Rassemble la matière sans rien publier : c'est ce que l'écran montre avant. */
export async function prepare(
  venture: { name: string; slug: string },
  kind: 'majeure' | 'mineure' | 'corrective' = 'mineure'
): Promise<ReleaseDraft> {
  const previous = releasesOf(venture.name)[0];
  const sinceHash = previous?.headHash ?? null;
  const since = previous?.at ?? 0;

  return {
    version: nextVersion(venture.name, kind),
    commits: await commitsSince(venture.slug, sinceHash),
    tickets: ticketsSince(venture.name, since),
    sinceHash,
    headHash: await head(venture.slug),
    since
  };
}

/**
 * Publie la version.
 *
 * Le journal est écrit par un agent à partir des commits et des tickets, pas
 * inventé : un journal qui ne correspond pas à ce qui est sorti est pire que
 * pas de journal. Puis on pose l'étiquette dans le dépôt du produit — elle
 * échoue silencieusement si git refuse, et la version reste valable.
 */
export async function publish(
  venture: { name: string; slug: string },
  draft: ReleaseDraft,
  openRouterKey: string
): Promise<{ release?: Release; error?: string }> {
  if (draft.commits.length === 0 && draft.tickets.length === 0) {
    return { error: 'Rien à publier : aucun commit ni ticket depuis la version précédente.' };
  }

  const graph = readGraph();
  const author =
    ['doc_agent', 'pm_agent', 'lead_dev'].map((id) => graph.find((agent) => agent.id === id)).find(Boolean) ?? graph[0];
  if (!author) return { error: 'Aucun agent disponible pour rédiger le journal.' };

  const started = Date.now();
  let changelog = '';
  let headline = '';

  try {
    const result = await runAgent(
      {
        id: author.id,
        role: author.role,
        model: author.modelId ?? 'google/gemini-2.5-flash',
        ame: [cultureBlock(readCulture()), author.ameMd ?? ''].filter(Boolean).join('\n\n'),
        job: author.jobMd,
        temperature: 0.3,
        maxSteps: 1,
        tools: []
      },
      changelogPrompt(venture.name, draft),
      { openRouterKey }
    );

    const text = (result.text ?? '').trim();
    // La première ligne sert de titre, le reste de journal.
    const [first, ...rest] = text.split('\n');
    headline = first.replace(/^#+\s*/, '').slice(0, 160);
    changelog = rest.join('\n').trim() || text;

    record({
      agentId: author.id,
      agentName: author.role,
      kind: 'atelier',
      label: `Journal de la version ${draft.version}`,
      model: result.modelUsed ?? author.modelId ?? '',
      tokensIn: result.tokensInput,
      tokensOut: result.tokensOutput,
      ms: Date.now() - started,
      ok: true,
      ventureName: venture.name
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Journal impossible à rédiger' };
  }

  // L'étiquette dans le dépôt : elle exige l'autonomie complète, et son échec
  // ne doit pas faire perdre la version.
  let tagged = false;
  try {
    const response = await bridge(
      'git',
      { args: ['tag', '-a', `v${draft.version}`, '-m', headline || `Version ${draft.version}`] },
      venture.slug,
      'full'
    );
    tagged = !response.error && !!response.result?.ok;
  } catch {
    tagged = false;
  }

  const release: Release = {
    id: `rel-${Date.now().toString(36)}`,
    ventureName: venture.name,
    version: draft.version,
    headline,
    changelog,
    commits: draft.commits,
    tickets: draft.tickets,
    sinceHash: draft.sinceHash,
    headHash: draft.headHash,
    at: Date.now(),
    tagged
  };

  writeReleases([release, ...readReleases()]);

  // Le journal rejoint la base de connaissance : c'est là qu'on le cherchera.
  upsertDoc({
    title: `Version ${release.version} — ${headline}`,
    path: `Versions/${venture.name}`,
    authorId: author.id,
    authorName: author.role,
    body: [
      `# Version ${release.version}`,
      headline ? `> ${headline}` : '',
      '',
      changelog,
      '',
      '## Tickets livrés',
      ...(release.tickets.length > 0 ? release.tickets.map((ticket) => `- ${ticket.title}`) : ['_Aucun._']),
      '',
      '## Commits',
      ...(release.commits.length > 0
        ? release.commits.map((commit) => `- \`${commit.hash}\` ${commit.subject} — ${commit.author}, ${commit.date}`)
        : ['_Aucun commit lu : le dépôt du produit est-il accessible ?_'])
    ]
      .filter(Boolean)
      .join('\n'),
    tags: ['version', release.version]
  });

  return { release };
}

export function removeRelease(id: string): void {
  writeReleases(readReleases().filter((release) => release.id !== id));
}

function changelogPrompt(ventureName: string, draft: ReleaseDraft): string {
  return [
    `[PRODUIT] ${ventureName}`,
    `[VERSION] ${draft.version}`,
    '',
    '[COMMITS DEPUIS LA VERSION PRÉCÉDENTE]',
    ...(draft.commits.length > 0
      ? draft.commits.map((commit) => `- ${commit.hash} ${commit.subject} (${commit.author}, ${commit.date})`)
      : ['_Aucun commit lu._']),
    '',
    '[TICKETS LIVRÉS]',
    ...(draft.tickets.length > 0 ? draft.tickets.map((ticket) => `- ${ticket.title}`) : ['_Aucun._']),
    '',
    'Écris le journal de cette version, pour quelqu’un qui utilise le produit — pas pour un développeur.',
    'Première ligne : ce que la version apporte, en une phrase, sans numéro de version.',
    'Ensuite, trois sections au maximum : **Ajouté**, **Modifié**, **Corrigé**. Une section vide se supprime.',
    '',
    "N'invente rien : chaque ligne doit correspondre à un commit ou un ticket ci-dessus. Un journal qui ne correspond pas à ce qui est sorti est pire que pas de journal.",
    'Traduis le jargon : « refacto du hook de fetch » ne dit rien à un utilisateur, dis ce qui change pour lui. Quand un commit est purement interne et sans effet visible, ne le mentionne pas.'
  ].join('\n');
}
