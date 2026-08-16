import React, { useState } from 'react';
import { saveRealAgentLog } from '../lib/agent-bus';
import { readCulture } from '../lib/culture';
import { addRequest, readGraph } from '../lib/hiring';
import { addTask, postMessage, upsertDoc } from '../lib/workspace';
import type { Venture } from '../types';
import { Portal } from './Portal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreateVenture: (venture: Venture) => void;
}

/* ------------------------------------------------------------------ */
/* Dossier produit par l'agence                                        */
/* ------------------------------------------------------------------ */

interface Dossier {
  idea: string;
  brief: string;
  market: string;
  name: string;
  slug: string;
  domain: string;
  tagline: string;
  positioning: string;
  gap: string;
  priceRange: string;
  opportunityScore: number;
  competitors: Array<{ name: string; url: string; price: string; strength: string; weakness: string }>;
  differentiators: string[];
  product: {
    mvpFeatures: string[];
    outOfScope: string[];
    stack: string[];
    integrations: string[];
    effortDays: number;
    mainTechnicalRisk: string;
  };
  design: {
    tone: string;
    palette: string[];
    typography: { heading: string; body: string };
    visualDirection: string;
    screens: Array<{ name: string; goal: string; keyElements: string[] }>;
  };
  pricing: { businessModel: string; trialCents: number; recurringCents: number; trialHours: number; rationale: string };
  growth: {
    acquisition: Array<{ channel: string; angle: string; firstAction: string }>;
    seoKeywords: string[];
    hook: string;
  };
  hiring: {
    covered: Array<{ need: string; byAgentId: string }>;
    hires: Array<{ role: string; hierarchyLevel: string; teamName: string; why: string; urgency: string }>;
  };
  risks: string[];
  sources: string[];
  /** Étapes qui ont échoué : le dossier est livré quand même, mais amputé. */
  warnings?: string[];
  tokens: number;
}

interface StepView {
  key: string;
  label: string;
  agentRole: string;
  model: string;
  status: 'start' | 'done';
  summary?: string;
  failed?: boolean;
}


/**
 * Le dossier ne reste pas dans une modale : il devient de la matière de travail
 * dans les ateliers — une fiche documentaire, des tâches assignées, et un mot
 * dans le canal produit.
 */
function spreadToWorkspaces(dossier: Dossier): void {
  upsertDoc({
    title: `Dossier de lancement — ${dossier.name}`,
    path: `Produits/${dossier.name}`,
    authorId: 'master',
    authorName: 'Victoria (CEO)',
    body: [
      `# ${dossier.name}`,
      `> ${dossier.tagline}`,
      '',
      `**Brief.** ${dossier.brief}`,
      `**Marché.** ${dossier.market}`,
      `**Positionnement.** ${dossier.positioning}`,
      `**Brèche.** ${dossier.gap}`,
      '',
      '## Concurrence',
      ...dossier.competitors.map((c) => `- **${c.name}** (${c.url}) — ${c.price} · fort : ${c.strength} · faible : ${c.weakness}`),
      '',
      '## Tarification',
      `${dossier.pricing.rationale}`,
      '',
      '## MVP',
      ...dossier.product.mvpFeatures.map((feature) => `- ${feature}`),
      '',
      '## Hors périmètre',
      ...dossier.product.outOfScope.map((entry) => `- ${entry}`),
      '',
      '## Sources réellement lues',
      ...dossier.sources.map((source) => `- ${source}`)
    ].join('\n')
  });

  for (const feature of dossier.product.mvpFeatures) {
    addTask({
      title: feature,
      status: 'todo',
      priority: 'haute',
      assigneeId: 'lead_dev',
      assigneeName: 'Head of Architecture',
      source: dossier.name,
      detail: `MVP de ${dossier.name}`
    });
  }

  for (const channel of dossier.growth.acquisition) {
    addTask({
      title: `${channel.channel} — ${channel.firstAction || channel.angle}`,
      status: 'todo',
      priority: 'moyenne',
      assigneeId: 'copywriter_agent',
      assigneeName: 'Lead Copywriting',
      source: dossier.name,
      labels: ['acquisition']
    });
  }

  postMessage({
    channel: 'produit',
    authorId: 'master',
    authorName: 'Victoria (CEO)',
    text: `Dossier « ${dossier.name} » prêt : ${dossier.product.mvpFeatures.length} fonctionnalités au MVP, ${dossier.competitors.length} concurrents étudiés, opportunité ${dossier.opportunityScore}/100.`
  });
}

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const EXAMPLES = [
  'Un SaaS qui humanise des textes IA et se positionne en SEO sur cette niche.',
  'Un service qui surveille les prix des concurrents e-commerce et alerte par e-mail.',
  'Un générateur de contrats freelance conformes, à la demande.'
];

/**
 * Lancement d'un business : l'opérateur écrit une phrase, l'agence produit le
 * dossier.
 *
 * Ce n'est pas un appel de modèle unique : chaque étape est menée par l'agent
 * compétent avec son propre modèle, et l'agence va réellement lire les sites
 * des concurrents avant d'analyser. La progression s'affiche au fil de l'eau.
 */
export const VentureFactoryModal: React.FC<Props> = ({ isOpen, onClose, onCreateVenture }) => {
  const [idea, setIdea] = useState('');
  const [steps, setSteps] = useState<StepView[]>([]);
  const [reads, setReads] = useState<Array<{ domain: string; pages?: number; done: boolean }>>([]);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiringSent, setHiringSent] = useState(false);

  if (!isOpen) return null;

  const run = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (idea.trim().length < 10 || busy) return;

    setBusy(true);
    setError(null);
    setSteps([]);
    setReads([]);
    setDossier(null);
    setHiringSent(false);

    const graph = readGraph();

    saveRealAgentLog({
      fromAgentId: 'master',
      fromAgentName: 'Victoria (CEO)',
      toAgentId: 'market_agent',
      toAgentName: 'Alex (Veille)',
      actionSummary: `Nouvelle idée à instruire : "${idea.trim().slice(0, 60)}"`,
      bubbleText: '🧭 On instruit cette idée',
      payloadSummary: idea.trim().slice(0, 200),
      costUsd: 0.00005,
      modelUsed: 'x-ai/grok-2'
    });

    try {
      const res = await fetch('/api/ventures/blueprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: idea.trim(),
          openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined,
          culture: readCulture(),
          graph: graph.map((agent) => ({
            id: agent.id,
            role: agent.role,
            modelId: agent.modelId,
            ameMd: agent.ameMd,
            jobMd: agent.jobMd,
            temperature: agent.temperature
          }))
        })
      });

      if (!res.ok || !res.body) {
        const failure = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(failure.error ?? `Erreur ${res.status}`);
      }

      // Flux ligne à ligne : on voit l'agence avancer au lieu d'attendre.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith('data:')) continue;
          let payload: any;
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          if (payload.type === 'step') {
            setSteps((prev) => {
              const next = prev.filter((entry) => entry.key !== payload.key);
              return [...next, payload as StepView].sort(
                (a, b) => Number(a.status === 'done') - Number(b.status === 'done')
              );
            });
            if (payload.status === 'done') {
              saveRealAgentLog({
                fromAgentId: payload.agentId,
                fromAgentName: payload.agentRole,
                toAgentId: 'master',
                toAgentName: 'Victoria (CEO)',
                actionSummary: `${payload.label} — ${payload.summary ?? 'terminé'}`,
                bubbleText: `📎 ${payload.label}`,
                payloadSummary: String(payload.summary ?? ''),
                costUsd: 0.0004,
                modelUsed: payload.model
              });
            }
          } else if (payload.type === 'read') {
            setReads((prev) => {
              const next = prev.filter((entry) => entry.domain !== payload.domain);
              return [...next, { domain: payload.domain, pages: payload.pages, done: payload.status === 'done' }];
            });
          } else if (payload.type === 'done') {
            const produced = payload.dossier as Dossier;
            setDossier(produced);
            spreadToWorkspaces(produced);
          } else if (payload.type === 'error') {
            setError(payload.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Préparation impossible');
    } finally {
      setBusy(false);
    }
  };

  /** Les postes manquants partent chez la DRH, qui rédigera les fiches. */
  const sendHiringToHr = () => {
    if (!dossier) return;
    for (const hire of dossier.hiring.hires) {
      addRequest({
        requestedById: 'master',
        requestedByName: `Projet ${dossier.name}`,
        teamName: hire.teamName || dossier.name,
        need: `${hire.role} — ${hire.why}`,
        urgency: (['basse', 'moyenne', 'haute'].includes(hire.urgency) ? hire.urgency : 'moyenne') as
          | 'basse'
          | 'moyenne'
          | 'haute'
      });
    }
    setHiringSent(true);
  };

  const create = () => {
    if (!dossier) return;
    const venture: Venture = {
      id: `vnt-${Date.now()}`,
      name: dossier.name,
      slug: dossier.slug,
      niche: dossier.positioning || dossier.market,
      type: 'saas',
      businessModel: (['trial_rebill', 'freemium', 'one_time', 'affiliate_commission'].includes(
        dossier.pricing.businessModel
      )
        ? dossier.pricing.businessModel
        : 'trial_rebill') as Venture['businessModel'],
      status: 'draft',
      domain: dossier.domain,
      stripeAccountId: '',
      priceTrialCents: dossier.pricing.trialCents,
      priceRecurringCents: dossier.pricing.recurringCents,
      trialDurationHours: dossier.pricing.trialHours,
      canaryTrafficPct: 0,
      activeVersion: 'v1.0.0',
      visitorsCount: 0,
      subscribersCount: 0,
      mrrCents: 0,
      totalRevenueCents: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveRealAgentLog({
      fromAgentId: 'master',
      fromAgentName: 'Victoria (CEO)',
      toAgentId: 'lead_dev',
      toAgentName: 'David (Architecte)',
      actionSummary: `Projet validé : ${dossier.name}`,
      bubbleText: `🚀 On construit ${dossier.name}`,
      payloadSummary: JSON.stringify({ mvp: dossier.product.mvpFeatures }),
      costUsd: 0.0001,
      modelUsed: 'x-ai/grok-2'
    });

    onCreateVenture(venture);
    onClose();
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
        <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Lancer un nouveau business</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Écrivez ce que vous voulez lancer. L'agence instruit le dossier : elle lit vraiment les sites des
                concurrents, puis chaque métier prend sa part.
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              ✕
            </button>
          </div>

          <form onSubmit={run} className="space-y-3 pt-4">
            <textarea
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              rows={3}
              autoFocus
              placeholder="Ex. « Un SaaS qui humanise des textes IA et se positionne en SEO sur cette niche. »"
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none"
            />

            {!dossier && !busy && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Exemples</span>
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setIdea(example)}
                    className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:border-indigo-400 hover:text-indigo-700"
                  >
                    {example.slice(0, 40)}…
                  </button>
                ))}
              </div>
            )}

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

            <button
              type="submit"
              disabled={busy || idea.trim().length < 10}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "L'agence travaille…" : dossier ? '↻ Refaire le dossier' : "🧠 Faire travailler l'agence"}
            </button>
          </form>

          {/* Progression : qui travaille, avec quel modèle */}
          {(steps.length > 0 || reads.length > 0) && (
            <div className="mt-4 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {steps.map((step) => (
                <div key={step.key} className="flex items-baseline gap-2 text-[11px]">
                  <span
                    className={
                      step.failed
                        ? 'text-amber-600'
                        : step.status === 'done'
                          ? 'text-emerald-600'
                          : 'animate-pulse text-indigo-600'
                    }
                  >
                    {step.failed ? '⚠' : step.status === 'done' ? '✓' : '●'}
                  </span>
                  <span className="font-semibold text-slate-800">{step.label}</span>
                  <span className="text-slate-500">— {step.agentRole}</span>
                  <span className="font-mono text-[9.5px] text-slate-400">{step.model}</span>
                  {step.summary && <span className="ml-auto text-slate-500">{step.summary}</span>}
                </div>
              ))}
              {reads.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-slate-200 pt-1.5">
                  {reads.map((read) => (
                    <span
                      key={read.domain}
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        read.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {read.domain}
                      {read.done && read.pages != null ? ` · ${read.pages}p` : ' …'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dossier */}
          {dossier && !busy && (
            <div className="mt-5 space-y-4 border-t border-slate-200 pt-5 text-sm">
              {dossier.warnings && dossier.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <strong>Dossier incomplet.</strong> Ces étapes n'ont pas abouti, le reste est exploitable :
                  <ul className="mt-1 list-disc pl-4">
                    {dossier.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-xl font-bold text-slate-900">{dossier.name}</h3>
                  <span className="font-mono text-[11px] text-slate-400">{dossier.domain}</span>
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    opportunité {dossier.opportunityScore}/100
                  </span>
                </div>
                <p className="mt-1 text-sm italic text-slate-700">« {dossier.tagline} »</p>
                <p className="mt-1.5 text-xs text-slate-600">{dossier.brief}</p>
              </div>

              {/* Concurrence réellement lue */}
              <Block title="Concurrence" hint={dossier.priceRange}>
                {dossier.competitors.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[9px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="py-1 pr-2">Acteur</th>
                          <th className="py-1 pr-2">Prix</th>
                          <th className="py-1 pr-2">Force</th>
                          <th className="py-1">Faiblesse</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 align-top">
                        {dossier.competitors.map((competitor, index) => (
                          <tr key={index}>
                            <td className="py-1.5 pr-2 font-semibold text-slate-800">{competitor.name}</td>
                            <td className="py-1.5 pr-2 font-mono text-indigo-700">{competitor.price}</td>
                            <td className="py-1.5 pr-2 text-slate-600">{competitor.strength}</td>
                            <td className="py-1.5 text-rose-700">{competitor.weakness}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[11px] italic text-slate-400">Aucun acteur identifié.</p>
                )}
                <p className="mt-2 text-xs font-medium text-slate-900">Brèche : {dossier.gap}</p>
                {dossier.sources.length > 0 && (
                  <p className="mt-1 font-mono text-[10px] text-slate-400">
                    Pages lues : {dossier.sources.map((source) => source.replace(/^https?:\/\//, '')).join(' · ')}
                  </p>
                )}
              </Block>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Block title="Produit" hint={`${dossier.product.effortDays} j de MVP`}>
                  <Bullets items={dossier.product.mvpFeatures} />
                  {dossier.product.outOfScope.length > 0 && (
                    <>
                      <p className="mt-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">Hors périmètre</p>
                      <Bullets items={dossier.product.outOfScope} muted />
                    </>
                  )}
                  {dossier.product.stack.length > 0 && (
                    <p className="mt-2 font-mono text-[10px] text-slate-400">{dossier.product.stack.join(' · ')}</p>
                  )}
                </Block>

                <Block title="Design & marque" hint={dossier.design.tone}>
                  <div className="flex items-center gap-1.5">
                    {dossier.design.palette.map((color) => (
                      <span
                        key={color}
                        title={color}
                        className="h-6 w-6 rounded border border-slate-300"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <span className="ml-1 font-mono text-[10px] text-slate-400">
                      {dossier.design.typography.heading} / {dossier.design.typography.body}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-600">{dossier.design.visualDirection}</p>
                  {dossier.design.screens.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-700">
                      {dossier.design.screens.map((screen, index) => (
                        <li key={index}>
                          <strong>{screen.name}</strong> — {screen.goal}
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Block title="Tarification">
                  <p className="font-mono text-sm font-bold text-slate-900">
                    {dossier.pricing.trialCents > 0
                      ? `${euros(dossier.pricing.trialCents)} / ${dossier.pricing.trialHours} h`
                      : 'Sans essai'}
                    {dossier.pricing.recurringCents > 0 && ` → ${euros(dossier.pricing.recurringCents)}/mois`}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600">{dossier.pricing.rationale}</p>
                </Block>

                <Block title="Acquisition" hint={dossier.growth.hook}>
                  <ul className="space-y-1 text-[11px] text-slate-700">
                    {dossier.growth.acquisition.map((channel, index) => (
                      <li key={index}>
                        <strong>{channel.channel}</strong> — {channel.angle}
                        {channel.firstAction && <em className="block text-slate-500">→ {channel.firstAction}</em>}
                      </li>
                    ))}
                  </ul>
                  {dossier.growth.seoKeywords.length > 0 && (
                    <p className="mt-1.5 font-mono text-[10px] text-slate-400">
                      {dossier.growth.seoKeywords.join(' · ')}
                    </p>
                  )}
                </Block>
              </div>

              {/* Recrutements */}
              <Block title="Recrutements nécessaires" hint="décidés par la DRH">
                {dossier.hiring.hires.length === 0 ? (
                  <p className="text-[11px] text-emerald-700">
                    Aucun recrutement : l'organisation actuelle couvre le projet.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1.5 text-[11px]">
                      {dossier.hiring.hires.map((hire, index) => (
                        <li key={index} className="rounded border border-slate-200 p-2">
                          <div className="flex flex-wrap items-baseline gap-1.5">
                            <strong className="text-slate-900">{hire.role}</strong>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                              {hire.hierarchyLevel}
                            </span>
                            <span className="text-slate-500">{hire.teamName}</span>
                            <span
                              className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                hire.urgency === 'haute'
                                  ? 'bg-rose-100 text-rose-700'
                                  : hire.urgency === 'basse'
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {hire.urgency}
                            </span>
                          </div>
                          <p className="mt-0.5 text-slate-600">{hire.why}</p>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={sendHiringToHr}
                      disabled={hiringSent}
                      className="mt-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 disabled:opacity-50"
                    >
                      {hiringSent ? '✓ Transmis à la DRH' : '→ Transmettre à la DRH'}
                    </button>
                  </>
                )}
                {dossier.hiring.covered.length > 0 && (
                  <p className="mt-2 text-[10px] text-slate-400">
                    Déjà couvert : {dossier.hiring.covered.map((entry) => entry.byAgentId).join(', ')}
                  </p>
                )}
              </Block>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
                <span className="font-mono text-[10px] text-slate-400">
                  {dossier.tokens.toLocaleString('fr-FR')} tokens · {steps.length} agents mobilisés
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={create}
                    className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                  >
                    ✓ Créer ce projet
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
};

const Block: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="rounded-lg border border-slate-200 p-3">
    <header className="mb-1.5 flex items-baseline gap-2">
      <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</h4>
      {hint && <span className="truncate text-[10px] text-slate-400">{hint}</span>}
    </header>
    {children}
  </section>
);

const Bullets: React.FC<{ items: string[]; muted?: boolean }> = ({ items, muted }) =>
  items.length === 0 ? null : (
    <ul className={`list-disc space-y-0.5 pl-4 text-[11px] ${muted ? 'text-slate-400' : 'text-slate-700'}`}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
