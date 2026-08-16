import React, { useCallback, useEffect, useState } from 'react';

interface SecretSummary {
  name: string;
  description: string;
  category: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  lastUsedBy: string | null;
  rotationDays: number;
  rotationDue: boolean;
}

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

/** Catégories courantes — pour ranger sans imposer. */
const CATEGORIES = ['modèles', 'paiement', 'infrastructure', 'marketing', 'e-mail', 'analytics', 'divers'];

/**
 * Coffre-fort de l'agence.
 *
 * Deux publics, deux traitements : vous voyez vos clés quand vous le demandez ;
 * les agents n'en connaissent que le NOM et l'usage, et écrivent
 * {{secret:NOM}} là où la valeur doit apparaître. La substitution a lieu côté
 * serveur, au dernier moment — une valeur qui entre dans le contexte d'un
 * modèle est une valeur publiée.
 */
export const VaultStudio: React.FC = () => {
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [status, setStatus] = useState<{ ready: boolean; keySource: string | null }>({ ready: false, keySource: null });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('modèles');
  const [rotationDays, setRotationDays] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/vault');
      const json = (await res.json()) as { secrets?: SecretSummary[]; status?: any; error?: string };
      setSecrets(json.secrets ?? []);
      setStatus(json.status ?? { ready: false, keySource: null });
      if (json.error) setError(json.error);
    } catch {
      setError('Coffre injoignable');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || value.trim().length < 1) return;
    setError(null);
    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value, description, category, rotationDays })
      });
      const json = (await res.json()) as { saved?: boolean; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `Erreur ${res.status}`);
      setName('');
      setValue('');
      setDescription('');
      await load();
      flash('Secret enregistré, chiffré au repos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
    }
  };

  const reveal = async (secretName: string) => {
    if (revealed[secretName]) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[secretName];
        return next;
      });
      return;
    }
    try {
      const res = await fetch('/api/vault/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: secretName })
      });
      const json = (await res.json()) as { value?: string; error?: string };
      if (!res.ok || json.error || json.value == null) throw new Error(json.error ?? 'Illisible');
      setRevealed((prev) => ({ ...prev, [secretName]: json.value as string }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Révélation impossible');
    }
  };

  const remove = async (secretName: string) => {
    await fetch('/api/vault', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: secretName })
    });
    await load();
  };

  const grouped = secrets.reduce<Record<string, SecretSummary[]>>((groups, secret) => {
    groups[secret.category] = groups[secret.category] ?? [];
    groups[secret.category].push(secret);
    return groups;
  }, {});

  return (
    <div className="space-y-5">
      {notice && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          {notice}
        </div>
      )}

      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Coffre-fort</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
          Vos clés, chiffrées au repos. <strong>Vous</strong> pouvez les revoir quand vous en avez besoin ; les agents,
          eux, n'en connaissent que le nom et l'usage et écrivent{' '}
          <code className="rounded bg-slate-100 px-1 font-mono text-[11px]">{'{{secret:NOM}}'}</code> — la valeur est
          substituée côté serveur, jamais dans leur contexte.
        </p>
        <p className="mt-2 text-[11px]">
          {status.ready ? (
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">
              Chiffrement actif — clé maîtresse{' '}
              {status.keySource === 'env' ? 'issue de l’environnement' : 'conservée dans KV'}
            </span>
          ) : (
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">
              Coffre inactif : définissez <code className="font-mono">VAULT_MASTER_KEY</code> ou activez l'espace KV.
            </span>
          )}
        </p>
      </header>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {/* Ajout */}
      <form onSubmit={save} className={`${CARD} space-y-3 p-4`}>
        <h2 className="text-sm font-bold text-slate-900">Ajouter une clé</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            value={name}
            onChange={(event) => setName(event.target.value.toUpperCase())}
            placeholder="STRIPE_SECRET_KEY"
            className="rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs text-slate-900"
          />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            type="password"
            placeholder="valeur"
            className="rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs text-slate-900 sm:col-span-2"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-800"
          >
            {CATEGORIES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="À quoi elle sert — c'est ce que verront les agents"
            className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 sm:col-span-3"
          />
          <label className="flex items-center gap-2 text-[11px] text-slate-600">
            Rotation
            <input
              type="number"
              min={0}
              value={rotationDays}
              onChange={(event) => setRotationDays(Number(event.target.value))}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            />
            jours
          </label>
        </div>

        <button
          type="submit"
          disabled={!status.ready || name.trim().length < 2 || value.trim().length < 1}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          🔐 Enregistrer
        </button>
      </form>

      {/* Inventaire */}
      {secrets.length === 0 ? (
        <div className={`${CARD} p-10 text-center`}>
          <p className="text-sm font-semibold text-slate-900">Coffre vide</p>
          <p className="mt-1 text-xs text-slate-500">
            Ajoutez vos clés ici : les agents sauront qu'elles existent et à quoi elles servent, sans jamais les voir.
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([group, entries]) => (
          <section key={group} className={`${CARD} p-4`}>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{group}</h3>
            <div className="space-y-2">
              {entries.map((secret) => (
                <article key={secret.name} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-mono text-xs text-slate-900">{secret.name}</strong>
                    {secret.rotationDue && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
                        rotation à faire
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-slate-500">
                      {revealed[secret.name] ?? secret.preview}
                    </span>
                    <button
                      type="button"
                      onClick={() => void reveal(secret.name)}
                      className="rounded border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {revealed[secret.name] ? 'masquer' : 'révéler'}
                    </button>
                    {revealed[secret.name] && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(revealed[secret.name]);
                          flash('Copié.');
                        }}
                        className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        copier
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(secret.name)}
                      className="rounded border border-rose-200 px-2 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50"
                    >
                      supprimer
                    </button>
                  </div>

                  <p className="mt-1 text-[11px] text-slate-600">{secret.description || 'Sans description'}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                    modifiée le {new Date(secret.updatedAt).toLocaleDateString('fr-FR')}
                    {secret.lastUsedAt
                      ? ` · dernier usage ${new Date(secret.lastUsedAt).toLocaleString('fr-FR')}${secret.lastUsedBy ? ` par ${secret.lastUsedBy}` : ''}`
                      : ' · jamais utilisée'}
                    {secret.rotationDays > 0 ? ` · rotation tous les ${secret.rotationDays} j` : ''}
                  </p>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
};
