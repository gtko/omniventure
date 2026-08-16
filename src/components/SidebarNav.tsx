import React, { useCallback, useEffect, useState } from 'react';
import { readLedger, LEDGER_EVENT } from '../lib/agent-ledger';
import { hydrate, readLocal, refresh as refreshState, STATE_HYDRATED_EVENT, writeLocal } from '../lib/local';
import { getStoredVentures, getActiveProjectId } from '../lib/store';
import type { Venture } from '../types';
import { ProjectPilot } from './ProjectPilot';
import { ProjectSwitcher } from './ProjectSwitcher';

interface Props {
  currentPath?: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** Renseigné pour une vue du produit : c'est la valeur de `?vue=`. */
  view?: string;
}

interface NavGroup {
  id: string;
  label: string;
  /** Un groupe rattaché au produit disparaît quand aucun n'est sélectionné. */
  needsProject?: boolean;
  items: NavItem[];
}

/**
 * La navigation, en une seule table.
 *
 * Les quatre groupes étaient quatre blocs de JSX copiés l'un sur l'autre, et
 * la liste globale existait deux fois — d'où des liens qui divergeaient selon
 * qu'un projet était sélectionné ou non. Une table, un rendu.
 *
 * Les vues du produit voyagent dans l'adresse (`?vue=`) : c'est ce qui permet
 * à un lien de la barre d'ouvrir directement la bonne section.
 */
const GROUPS: NavGroup[] = [
  {
    id: 'vues',
    label: 'Vues',
    needsProject: true,
    items: [
      { label: 'Aperçu', href: '/', icon: '👁️', view: 'apercu' },
      { label: 'Direction', href: '/?vue=direction', icon: '🧭', view: 'direction' },
      { label: 'Chantier', href: '/?vue=chantier', icon: '🔨', view: 'chantier' },
      { label: 'Tickets', href: '/?vue=tickets', icon: '🎫', view: 'tickets' },
      // La mesure était une page de l'agence ; ce sont pourtant les chiffres
      // d'un produit précis — son trafic, ses tests, son acquisition.
      { label: 'Mesure', href: '/?vue=mesure', icon: '📊', view: 'mesure' },
      { label: 'Livrables', href: '/?vue=livrables', icon: '📦', view: 'livrables' },
      { label: 'Réglages', href: '/?vue=reglages', icon: '⚙️', view: 'reglages' }
    ]
  },
  {
    /*
     * Un logo, une palette et des composants appartiennent à **un** produit et
     * changent avec lui. Le travail y circule dans cet ordre : du visuel au
     * système, du système au composant.
     */
    id: 'design',
    label: 'Design',
    needsProject: true,
    items: [
      { label: 'Graphisme', href: '/?vue=graphisme', icon: '🎨', view: 'graphisme' },
      { label: 'Design system', href: '/?vue=design-system', icon: '🧩', view: 'design-system' },
      { label: 'Composants', href: '/?vue=composants', icon: '🔲', view: 'composants' }
    ]
  },
  {
    id: 'pilotage',
    label: 'Pilotage',
    needsProject: true,
    items: [
      { label: 'Rituels & sprints', href: '/rituels', icon: '🔁' },
      { label: 'Agenda', href: '/agenda', icon: '📅' }
    ]
  },
  {
    id: 'agence',
    label: 'Agence',
    items: [
      { label: 'Bureau virtuel 2D', href: '/office', icon: '🏢' },
      { label: 'Tous mes business', href: '/ventures', icon: '📂' },
      { label: 'Analyse concurrents', href: '/market', icon: '🔍' },
      { label: 'Graphe d’agents', href: '/agents', icon: '🧠' },
      { label: 'Ressources humaines', href: '/hr', icon: '🧑‍💼' },
      // Deux pages voisines sans qu'on sache laquelle ouvrir : elles font
      // toutes deux tourner un agent hors du chantier d'un produit.
      { label: 'Missions', href: '/missions', icon: '🛰️' },
      { label: 'Harnais de codage', href: '/harness', icon: '🛠️' },
      { label: 'Discussions', href: '/discussions', icon: '💬' },
      { label: 'Documentation', href: '/documentation', icon: '📓' },
      { label: 'Coffre-fort', href: '/vault', icon: '🔐' }
    ]
  }
];

const COLLAPSE_KEY = 'omniventure_nav_collapsed_v1';

/**
 * Les groupes repliés.
 *
 * L'état doit survivre à la navigation : chaque lien recharge la page, et un
 * état de composant serait remis à plat à chaque clic — le groupe qu'on vient
 * de replier se rouvrirait aussitôt.
 */
function readCollapsed(): string[] {
  const raw = readLocal(COLLAPSE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface Usage {
  connected: boolean;
  reason?: string;
  allTime: number | null;
  last7d: number | null;
  today: number | null;
  lastHour: number | null;
  remaining?: number;
  source?: string;
}

/** Ce que l'agence a dépensé depuis une borne, d'après son propre registre. */
function spentSince(boundary: number): number {
  return readLedger()
    .filter((entry) => entry.at >= boundary)
    .reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
}

export const SidebarNav: React.FC<Props> = ({ currentPath = '/' }) => {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  /**
   * La vue ouverte dans la page du produit. Elle est lue dans l'adresse plutôt
   * que reçue en propriété : la barre est rendue par Astro, qui ne connaît que
   * le chemin, pas la chaîne de requête.
   */
  const [currentView, setCurrentView] = useState<string>('apercu');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  /** Le repli local, calculé sur le registre de l'agence. */
  const [local, setLocal] = useState({ today: 0, last7d: 0, lastHour: 0 });

  const loadData = useCallback(() => {
    setVentures(getStoredVentures());
    setActiveId(getActiveProjectId() || '');
  }, []);

  const loadLocal = useCallback(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    setLocal({
      today: spentSince(midnight.getTime()),
      last7d: spentSince(Date.now() - 7 * 24 * 3600_000),
      lastHour: spentSince(Date.now() - 3600_000)
    });
  }, []);

  useEffect(() => {
    /*
     * L'état vient de la base. La barre est montée sur toutes les pages : c'est
     * l'endroit naturel pour l'aller chercher une fois, puis pour rapatrier ce
     * que le serveur écrit de son côté — un chantier qui livre, un agent qui
     * crée une tâche — sans attendre un rechargement.
     */
    void hydrate();
    const syncTimer = window.setInterval(() => void refreshState(), 20000);
    window.addEventListener(STATE_HYDRATED_EVENT, loadData);

    loadData();
    loadLocal();
    setCollapsed(readCollapsed());
    setCurrentView(new URLSearchParams(window.location.search).get('vue') ?? 'apercu');

    const onVentures = () => loadData();
    const onActive = (event: any) => {
      if (event.detail?.id) setActiveId(event.detail.id);
    };
    window.addEventListener('ventures-updated', onVentures);
    window.addEventListener('active-project-changed', onActive);
    window.addEventListener(LEDGER_EVENT, loadLocal);

    const pollUsage = async () => {
      try {
        const res = await fetch('/api/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openRouterKey: readLocal('omniventure_openrouter_key') ?? undefined })
        });
        if (res.ok) setUsage(await res.json());
      } catch {
        /* hors ligne */
      }
    };
    void pollUsage();
    const usageInterval = window.setInterval(pollUsage, 120000);
    const localInterval = window.setInterval(loadLocal, 30000);

    return () => {
      window.removeEventListener('ventures-updated', onVentures);
      window.removeEventListener('active-project-changed', onActive);
      window.removeEventListener(LEDGER_EVENT, loadLocal);
      window.removeEventListener(STATE_HYDRATED_EVENT, loadData);
      window.clearInterval(usageInterval);
      window.clearInterval(localInterval);
      window.clearInterval(syncTimer);
    };
  }, [loadData, loadLocal]);

  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((entry) => entry !== id) : [...collapsed, id];
    setCollapsed(next);
    writeLocal(COLLAPSE_KEY, JSON.stringify(next));
  };

  const activeVenture = ventures.find((entry) => entry.id === activeId);
  const hasProject = !!activeVenture;
  const groups = GROUPS.filter((group) => hasProject || !group.needsProject);

  /**
   * Une fenêtre de dépense, avec sa provenance.
   *
   * OpenRouter ne donne qu'un compteur cumulé : le découpage par période vient
   * de relevés successifs, et reste donc vide tant qu'aucun relevé n'est
   * antérieur à la borne — sur une installation récente, « 7 jours » et
   * « aujourd'hui » restaient désespérément à «—» alors que l'agence dépensait.
   * À défaut de relevé, on montre ce que l'agence a elle-même dépensé, d'après
   * son registre. C'est un plancher exact, pas une estimation.
   */
  const window_ = (measured: number | null | undefined, fallback: number) =>
    measured != null && measured > 0
      ? { value: measured, exact: true }
      : { value: fallback, exact: measured != null };

  const spend = [
    { label: 'Total', value: usage?.allTime ?? null, exact: true },
    { label: '7 jours', ...window_(usage?.last7d, local.last7d) },
    { label: "Aujourd'hui", ...window_(usage?.today, local.today) },
    { label: '1 heure', ...window_(usage?.lastHour, local.lastHour) }
  ];

  const estimated = spend.some((entry) => !entry.exact && (entry.value ?? 0) > 0);

  return (
    <aside className="app-nav w-64 bg-white border-r border-slate-200 min-h-screen flex flex-col justify-between flex-shrink-0 z-30">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Marque */}
        <a href="/" className="flex items-center gap-2.5 px-1 py-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-xs">
            Ω
          </div>
          <div>
            <div className="font-bold text-sm text-slate-900 tracking-tight leading-none">OmniVenture</div>
            <span className="text-[10px] text-slate-400 font-mono">Cloudflare OS</span>
          </div>
        </a>

        <ProjectSwitcher />

        {/*
          Le pilote du produit.

          Ici se trouvait un badge « canary » — un vestige d'un bouton de
          déploiement qui ne déployait rien, annonçant un routage de trafic
          inexistant. À sa place : de quoi lancer l'agence, l'arrêter, et voir
          quand elle attend une réponse de vous.
        */}
        {activeVenture && (
          <ProjectPilot
            venture={{ id: activeVenture.id, name: activeVenture.name, slug: activeVenture.slug ?? activeVenture.id }}
          />
        )}

        {!hasProject && (
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1 text-amber-900">
            <div className="font-bold flex items-center gap-1 text-[11px]">
              <span>ℹ️</span>
              <span>Aucun projet sélectionné</span>
            </div>
            <p className="text-[11px] text-amber-800 leading-snug">
              Sélectionnez ou créez un projet : le chantier, la feuille de route et la mesure sont rattachés à un
              produit.
            </p>
          </div>
        )}

        <nav className="space-y-3">
          {groups.map((group) => {
            const shut = collapsed.includes(group.id);
            return (
              <div key={group.id} className="space-y-1 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={!shut}
                  className="flex w-full items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider font-mono text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                >
                  <span className={`text-[8px] transition-transform ${shut ? '' : 'rotate-90'}`}>▶</span>
                  <span>{group.label}</span>
                  {shut && <span className="ml-auto text-[9px] font-normal normal-case">{group.items.length}</span>}
                </button>

                {!shut && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = item.view
                        ? currentPath === '/' && currentView === item.view
                        : currentPath === item.href;
                      return (
                        <a
                          key={item.href}
                          href={item.href}
                          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            active
                              ? 'bg-indigo-50 text-indigo-700 font-semibold'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                          }`}
                        >
                          <span className="text-sm">{item.icon}</span>
                          <span>{item.label}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/*
        Ce que l'agence coûte.

        Il y avait ici une grille de témoins verts — « 285+ datacenters »,
        « 7 threads 24/7 », « 100 % santé » — écrits en dur : ils affichaient la
        même chose que le service tourne ou non. Ne reste que ce qui est mesuré.
      */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-700 tracking-tight">Coûts OpenRouter</span>
          {usage?.connected ? (
            <span className="font-mono text-[9px] text-slate-400">
              {usage.remaining != null ? `reste $${usage.remaining.toFixed(2)}` : ''}
            </span>
          ) : (
            <span className="font-mono text-[9px] text-amber-600" title={usage?.reason}>
              clé absente
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
          {spend.map((entry) => (
            <div key={entry.label} className="rounded bg-white px-1.5 py-1 border border-slate-200">
              <span className="block text-[9px] text-slate-400">{entry.label}</span>
              <span className="font-bold text-slate-900">
                {entry.value == null ? '—' : `$${entry.value.toFixed(entry.value < 1 ? 4 : 2)}`}
                {!entry.exact && (entry.value ?? 0) > 0 && <span className="text-slate-400"> ≈</span>}
              </span>
            </div>
          ))}
        </div>

        {estimated && (
          <p className="text-[9px] leading-snug text-slate-400">
            ≈ dépense relevée dans le registre de l'agence, en attendant assez de relevés OpenRouter pour couvrir la
            période.
          </p>
        )}
      </div>
    </aside>
  );
};
