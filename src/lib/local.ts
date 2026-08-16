/**
 * Lecture et écriture du stockage local, sans casser le rendu serveur.
 *
 * Astro rend les îlots React une première fois sur le serveur, avant de les
 * hydrater dans le navigateur. À ce moment-là, `localStorage` n'est pas
 * l'objet du navigateur : selon l'environnement il est absent, ou présent sous
 * la forme d'un objet vide. Le second cas est le plus traître —
 * `typeof localStorage !== 'undefined'` répond « défini », puis l'appel à
 * `getItem` échoue et la page entière rend une erreur.
 *
 * D'où ce module : la seule vérification qui tient est celle de `window`, et
 * on protège quand même l'appel — un navigateur en navigation privée peut
 * refuser l'accès au stockage.
 */

export function readLocal(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage refusé ou plein : le choix vaut pour cette session */
  }
}

export function removeLocal(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* rien à faire */
  }
}
