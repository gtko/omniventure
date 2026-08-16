import React, { useCallback, useEffect, useState } from 'react';
import { saveRealAgentLog } from '../../lib/agent-bus';
import { agentCall } from '../../lib/agent-profile';
import { readCulture } from '../../lib/culture';
import { readGraph } from '../../lib/hiring';

export interface StoredAsset {
  id: string;
  url: string;
  bytes: number;
  contentType: string;
  prompt: string;
  model: string;
  kind: string;
  project: string;
  createdAt: number;
}

interface ImageModel {
  id: string;
  name: string;
  imagePrice: number;
}

const KINDS = [
  { id: 'logo', label: 'Logo' },
  { id: 'illustration', label: 'Illustration' },
  { id: 'maquette', label: "Maquette d'écran" },
  { id: 'icone', label: 'Icônes' },
  { id: 'banniere', label: 'Bannière' }
];

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/**
 * Atelier du graphiste — l'équivalent d'une table à dessin.
 *
 * Le résultat est binaire et doit se voir : chaque visuel est généré par un
 * modèle d'image, déposé dans R2, puis affiché ici. La palette relevée sur un
 * visuel part ensuite chez la designeuse système.
 */
export const GraphicStudio: React.FC<{ onPalette?: (colors: string[], logoAssetId?: string) => void }> = ({
  onPalette
}) => {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [models, setModels] = useState<ImageModel[]>([]);
  // Le modèle vient de la fiche du graphiste ; le menu permet un écart ponctuel.
  const [model, setModel] = useState(() => agentCall('image').model ?? 'google/gemini-2.5-flash-image');
  const [kind, setKind] = useState('logo');
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState('');
  const [palette, setPalette] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StoredAsset | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/design/assets');
      if (res.ok) {
        const json = (await res.json()) as { assets: StoredAsset[] };
        setAssets(json.assets ?? []);
      }
    } catch {
      /* hors ligne */
    }
  }, []);

  useEffect(() => {
    void load();
    // Liste vivante : on n'écrit aucun catalogue de modèles en dur.
    void (async () => {
      try {
        const key = localStorage.getItem('omniventure_openrouter_key');
        const res = await fetch(`/api/design/models${key ? `?key=${encodeURIComponent(key)}` : ''}`);
        if (!res.ok) return;
        const json = (await res.json()) as { models: ImageModel[] };
        setModels(json.models ?? []);
        // On ne remplace le modèle de l'agent que s'il n'existe plus chez OpenRouter.
        if (json.models?.length && !json.models.some((entry) => entry.id === model)) {
          setModel(json.models[0].id);
        }
      } catch {
        /* liste indisponible : on garde le modèle par défaut */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const generate = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (prompt.trim().length < 5 || busy) return;

    setBusy(true);
    setError(null);

    const graphic = readGraph().find((agent) => agent.id === 'graphic_agent');

    saveRealAgentLog({
      fromAgentId: 'design_lead',
      fromAgentName: 'Iris (Design)',
      toAgentId: 'graphic_agent',
      toAgentName: 'Milo (Graphiste)',
      actionSummary: `Commande : ${kind} — ${prompt.trim().slice(0, 50)}`,
      bubbleText: `🎨 ${kind} à produire`,
      payloadSummary: prompt.trim().slice(0, 200),
      costUsd: 0,
      modelUsed: model
    });

    try {
      const res = await fetch('/api/design/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          kind,
          model,
          count,
          project: project.trim() || undefined,
          palette: palette
            .split(/[,\s]+/)
            .map((color) => color.trim())
            .filter((color) => /^#?[0-9a-f]{3,8}$/i.test(color))
            .map((color) => (color.startsWith('#') ? color : `#${color}`)),
          persona: graphic?.ameMd,
          job: graphic?.jobMd,
          culture: readCulture(),
          openRouterKey: localStorage.getItem('omniventure_openrouter_key') ?? undefined
        })
      });

      const json = (await res.json()) as { assets?: StoredAsset[]; error?: string; failures?: string[] };
      if (!res.ok || json.error || !json.assets?.length) throw new Error(json.error ?? `Erreur ${res.status}`);

      saveRealAgentLog({
        fromAgentId: 'graphic_agent',
        fromAgentName: 'Milo (Graphiste)',
        toAgentId: 'design_system_agent',
        toAgentName: 'Anaïs (Design système)',
        actionSummary: `${json.assets.length} visuel(s) livré(s) — ${kind}`,
        bubbleText: '🖼️ Visuels prêts',
        payloadSummary: JSON.stringify({ ids: json.assets.map((asset) => asset.id) }),
        costUsd: 0.004 * json.assets.length,
        modelUsed: json.assets[0].model
      });

      await load();
      setSelected(json.assets[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Génération impossible');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (asset: StoredAsset) => {
    await fetch(`/api/design/asset/${asset.id}`, { method: 'DELETE' });
    if (selected?.id === asset.id) setSelected(null);
    await load();
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
      {/* Commande */}
      <form onSubmit={generate} className={`${CARD} h-fit space-y-3 p-4`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900">🎨 Atelier graphique</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Milo produit les visuels binaires. Ils sont stockés dans R2 et réutilisables par toute l'agence.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setKind(entry.id)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                kind === entry.id
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          placeholder="Ex. « Logo pour TextGenius : un G stylisé formé d'un curseur de texte, moderne, bleu indigo. »"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:bg-white focus:outline-none"
        />

        <div className="grid grid-cols-2 gap-2">
          <input
            value={project}
            onChange={(event) => setProject(event.target.value)}
            placeholder="Produit"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
          <input
            value={palette}
            onChange={(event) => setPalette(event.target.value)}
            placeholder="#4f46e5 #0f172a"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
          />
        </div>

        <label className="block text-[11px] font-semibold text-slate-600">
          Modèle de génération
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-normal text-slate-800"
          >
            {models.length === 0 ? (
              <option value={model}>{model}</option>
            ) : (
              models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} {entry.imagePrice ? `— ${(entry.imagePrice * 1000).toFixed(3)} $/1k jetons image` : ''}
                </option>
              ))
            )}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-600">
            Variantes
            <select
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className="ml-1.5 rounded-lg border border-slate-300 px-2 py-1 text-xs font-normal"
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy || prompt.trim().length < 5}
            className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Milo dessine…' : '✨ Générer'}
          </button>
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</p>}
      </form>

      {/* Galerie */}
      <div className="space-y-4">
        {selected && (
          <div className={`${CARD} p-4`}>
            <div className="flex flex-col gap-4 sm:flex-row">
              <img
                src={selected.url}
                alt={selected.prompt}
                className="max-h-72 w-full rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] object-contain sm:w-1/2"
              />
              <div className="min-w-0 flex-1 space-y-2 text-xs">
                <p className="font-semibold text-slate-900">{selected.kind}</p>
                <p className="leading-relaxed text-slate-600">{selected.prompt}</p>
                <p className="font-mono text-[10px] text-slate-400">
                  {selected.model} · {(selected.bytes / 1024).toFixed(0)} ko · {selected.id}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <a
                    href={selected.url}
                    download={selected.id}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    ⬇ Télécharger
                  </a>
                  {onPalette && (
                    <button
                      type="button"
                      onClick={() =>
                        onPalette(
                          palette
                            .split(/[,\s]+/)
                            .map((color) => color.trim())
                            .filter(Boolean),
                          selected.id
                        )
                      }
                      className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
                    >
                      → Envoyer à la designeuse
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(selected)}
                    className="rounded-lg border border-rose-300 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {assets.length === 0 ? (
          <div className={`${CARD} p-10 text-center`}>
            <p className="text-sm font-semibold text-slate-900">Aucun visuel</p>
            <p className="mt-1 text-xs text-slate-500">
              Décrivez ce qu'il faut produire : le visuel sera généré, stocké dans R2, et disponible pour la designeuse
              et le frontend.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSelected(asset)}
                className={`overflow-hidden rounded-lg border text-left transition-colors ${
                  selected?.id === asset.id ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <img
                  src={asset.url}
                  alt={asset.prompt}
                  loading="lazy"
                  className="h-28 w-full bg-slate-50 object-contain"
                />
                <span className="block truncate border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
                  {asset.kind} · {asset.prompt.slice(0, 40)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
