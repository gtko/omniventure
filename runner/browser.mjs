/**
 * Pilotage de Chrome — naviguer, cliquer, saisir, se connecter.
 *
 * Les outils `browser_read` et `browser_screenshot` lancent Chrome une fois et
 * le referment : ils ne peuvent ni cliquer, ni remplir un formulaire, ni
 * conserver une session. Ici, Chrome reste ouvert derrière un profil nommé, et
 * on lui parle par le protocole DevTools — donc les cookies de connexion
 * survivent d'un appel à l'autre.
 *
 * Aucune dépendance : Node fournit désormais WebSocket, et Chrome expose son
 * protocole en HTTP + WebSocket sur le port de débogage.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Une instance de Chrome par profil : les sessions ne se mélangent pas. */
const browsers = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Démarre Chrome pour un profil, ou réutilise celui qui tourne déjà.
 * Le dossier de profil est persistant : une connexion établie reste valable.
 */
export async function ensureBrowser(chromePath, profile = 'agence') {
  const existing = browsers.get(profile);
  if (existing && !existing.child.killed) {
    if (await isAlive(existing.port)) return existing;
    browsers.delete(profile);
  }

  const userDataDir = join(tmpdir(), 'omniventure-chrome', profile);
  mkdirSync(userDataDir, { recursive: true });

  // Port fixe dérivé du nom : on retrouve l'instance après un redémarrage du pont.
  const port = 9500 + (hash(profile) % 400);

  if (await isAlive(port)) {
    const session = { port, userDataDir, child: { killed: false, kill() {} } };
    browsers.set(profile, session);
    return session;
  }

  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--hide-scrollbars',
      // Sans taille explicite, les captures sortent en 762×428 : illisible.
      '--window-size=1280,900',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, detached: false }
  );
  child.stderr?.on('data', () => {});

  // Chrome met un instant à ouvrir son port de débogage.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isAlive(port)) {
      const session = { port, userDataDir, child };
      browsers.set(profile, session);
      return session;
    }
    await sleep(250);
  }

  child.kill();
  throw new Error("Chrome n'a pas ouvert son port de débogage");
}

export function closeBrowser(profile) {
  const session = browsers.get(profile);
  if (!session) return false;
  try {
    session.child.kill();
  } catch {
    /* déjà arrêté */
  }
  browsers.delete(profile);
  return true;
}

async function isAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) });
    return res.ok;
  } catch {
    return false;
  }
}

const hash = (text) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);

/* ------------------------------------------------------------------ */
/* Dialogue avec l'onglet                                              */
/* ------------------------------------------------------------------ */

/** Ouvre une connexion au premier onglet, exécute une séquence, referme. */
async function withTab(port, run) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
  let target = list.find((entry) => entry.type === 'page');
  if (!target) {
    target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((res) => res.json());
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Connexion au navigateur impossible')), { once: true });
  });

  socket.addEventListener('message', (message) => {
    const payload = JSON.parse(message.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
    } else if (payload.method) {
      events.push(payload);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Délai dépassé : ${method}`));
        }
      }, 30_000);
    });

  try {
    return await run({ send, events });
  } finally {
    socket.close();
  }
}

/** Navigue et attend que la page soit posée. */
async function goto({ send }, url) {
  await send('Page.enable');
  await send('Page.navigate', { url });
  // Le chargement complet n'est pas garanti : on laisse le rendu se faire.
  await sleep(2500);
}

const evaluate = ({ send }, expression) =>
  send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(
    (result) => result?.result?.value
  );

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/**
 * Remplit un couple identifiant / mot de passe et valide.
 *
 * Les champs sont trouvés par leur type et leur nom, et remplis via le setter
 * natif suivi d'un événement `input` — sans quoi les interfaces modernes
 * ignorent la valeur, leur état interne n'ayant pas changé.
 */
const LOGIN_SCRIPT = (username, password) => `(() => {
  const setValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const password = document.querySelector('input[type="password"]');
  const identifiers = [
    'input[type="email"]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
    'input[autocomplete="username"]',
    'input[type="text"]'
  ];
  let user = null;
  for (const selector of identifiers) {
    const found = document.querySelector(selector);
    if (found && found !== password) { user = found; break; }
  }

  if (user) setValue(user, ${JSON.stringify(username)});
  if (password) setValue(password, ${JSON.stringify(password)});

  const form = (password || user)?.closest('form');
  const submit =
    form?.querySelector('button[type="submit"], input[type="submit"]') ||
    document.querySelector('button[type="submit"], input[type="submit"]');

  if (submit) submit.click();
  else if (form) form.requestSubmit ? form.requestSubmit() : form.submit();

  return {
    identifiantTrouve: !!user,
    motDePasseTrouve: !!password,
    formulaireEnvoye: !!(submit || form)
  };
})()`;

export async function browserLogin(chromePath, { url, username, password, profile = 'agence' }) {
  const { port } = await ensureBrowser(chromePath, profile);
  return withTab(port, async (tab) => {
    await goto(tab, url);
    const filled = await evaluate(tab, LOGIN_SCRIPT(username, password));
    await sleep(3500); // le temps que la validation aboutisse

    const after = await evaluate(
      tab,
      `({ url: location.href, titre: document.title, connecte: !document.querySelector('input[type="password"]') })`
    );
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
    return { ...filled, ...after, screenshotBase64: shot?.data ?? null };
  });
}

/** Action générique sur la page : naviguer, cliquer, saisir, lire, capturer. */
export async function browserAct(chromePath, { action, url, selector, value, profile = 'agence' }) {
  const { port } = await ensureBrowser(chromePath, profile);
  return withTab(port, async (tab) => {
    switch (action) {
      case 'goto':
        await goto(tab, url);
        return evaluate(tab, `({ url: location.href, titre: document.title })`);

      case 'click': {
        const clicked = await evaluate(
          tab,
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`
        );
        await sleep(1500);
        return { clicked, url: await evaluate(tab, 'location.href') };
      }

      case 'type': {
        const typed = await evaluate(
          tab,
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, ${JSON.stringify(value ?? '')});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()`
        );
        return { typed };
      }

      case 'text': {
        const text = await evaluate(tab, 'document.body.innerText');
        return { chars: (text ?? '').length, text: (text ?? '').slice(0, 12000) };
      }

      case 'screenshot': {
        const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
        return { screenshotBase64: shot?.data ?? null };
      }

      default:
        throw new Error(`Action inconnue : ${action}`);
    }
  });
}
