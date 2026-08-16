/**
 * Mouchard OmniVenture — à embarquer dans les produits de l'agence.
 *
 *   <script defer src="https://VOTRE-AGENCE/track.js" data-site="pricewatch"></script>
 *
 * Ensuite, depuis la page :
 *   omni('inscription')                        un événement
 *   omni('achat', { plan: 'pro' }, 2900)       avec des propriétés et un montant
 *   omni.variant('couleur-cta')                la variante A/B attribuée
 *
 * Trois partis pris.
 *
 * L'affectation A/B se fait **dans le navigateur**, par hachage de l'identifiant
 * anonyme : pas d'appel bloquant avant l'affichage, donc pas de clignotement de
 * la page, et une variante stable pour un même visiteur. Le serveur apprend
 * l'exposition par un événement, comme le reste.
 *
 * L'envoi passe par `sendBeacon` quand il existe : c'est le seul moyen qu'un
 * événement émis au moment où l'on quitte la page arrive vraiment.
 *
 * Aucun cookie. Un identifiant anonyme dans le stockage local, une session qui
 * se renouvelle après trente minutes d'inactivité. Rien qui identifie une
 * personne, donc rien qui exige une bannière de consentement pour exister —
 * mais c'est à chaque produit de vérifier ce que sa juridiction impose.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var site = (script && script.getAttribute('data-site')) || '';
  if (!site) {
    console.warn('[omni] data-site manquant : rien ne sera mesuré.');
    return;
  }

  var origin = script ? new URL(script.src, location.href).origin : location.origin;
  var endpoint = origin + '/api/track';
  var configUrl = origin + '/api/analytics/config?site=' + encodeURIComponent(site);

  /* ---------------------------------------------------------------- */
  /* Identité                                                          */
  /* ---------------------------------------------------------------- */

  var ANON_KEY = 'omni_anon';
  var SESSION_KEY = 'omni_session';
  var SESSION_MS = 30 * 60 * 1000;

  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function anonId() {
    try {
      var stored = localStorage.getItem(ANON_KEY);
      if (stored) return stored;
      var fresh = uid();
      localStorage.setItem(ANON_KEY, fresh);
      return fresh;
    } catch (error) {
      // Stockage refusé : la mesure continue, sans continuité entre visites.
      return uid();
    }
  }

  function sessionId() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      var now = Date.now();
      if (raw) {
        var parsed = JSON.parse(raw);
        if (now - parsed.at < SESSION_MS) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: parsed.id, at: now }));
          return parsed.id;
        }
      }
      var fresh = uid();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: fresh, at: now }));
      return fresh;
    } catch (error) {
      return uid();
    }
  }

  var anon = anonId();

  function device() {
    var width = window.innerWidth || 1024;
    return width < 640 ? 'mobile' : width < 1024 ? 'tablette' : 'ordinateur';
  }

  /* ---------------------------------------------------------------- */
  /* Envoi                                                             */
  /* ---------------------------------------------------------------- */

  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      // Texte brut volontairement : un beacon en application/json déclenche un
      // préflight, et le préflight n'a pas le temps d'aboutir au déchargement.
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return;
    } catch (error) {
      /* on retombe sur fetch */
    }
    try {
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, mode: 'cors' });
    } catch (error) {
      /* perdu : un événement manquant ne doit jamais casser la page */
    }
  }

  function track(event, props, value) {
    if (!event) return;
    send({
      site: site,
      event: String(event),
      anonId: anon,
      sessionId: sessionId(),
      url: location.href,
      referrer: document.referrer || null,
      device: device(),
      value: typeof value === 'number' ? value : undefined,
      props: props && typeof props === 'object' ? props : undefined
    });
  }

  /* ---------------------------------------------------------------- */
  /* Tests A/B                                                         */
  /* ---------------------------------------------------------------- */

  var experiments = [];
  var assigned = {};

  /** Hachage stable : le même visiteur retombe toujours sur la même variante. */
  function hash(text) {
    var value = 2166136261;
    for (var i = 0; i < text.length; i++) {
      value ^= text.charCodeAt(i);
      value = (value * 16777619) >>> 0;
    }
    return value;
  }

  function assign(experiment) {
    var variants = experiment.variants || [];
    if (variants.length === 0) return null;

    var total = variants.reduce(function (sum, variant) {
      return sum + (variant.weight || 1);
    }, 0);
    var point = (hash(anon + ':' + experiment.key) % 10000) / 10000 * total;

    var running = 0;
    for (var i = 0; i < variants.length; i++) {
      running += variants[i].weight || 1;
      if (point < running) return variants[i].key;
    }
    return variants[variants.length - 1].key;
  }

  function loadExperiments() {
    try {
      fetch(configUrl, { mode: 'cors' })
        .then(function (response) {
          return response.json();
        })
        .then(function (data) {
          experiments = (data && data.experiments) || [];
          var exposures = [];
          for (var i = 0; i < experiments.length; i++) {
            var variant = assign(experiments[i]);
            if (!variant) continue;
            assigned[experiments[i].key] = variant;
            exposures.push({
              site: site,
              event: '$exposure',
              anonId: anon,
              sessionId: sessionId(),
              url: location.href,
              device: device(),
              props: { experiment: experiments[i].key, variant: variant }
            });
          }
          if (exposures.length > 0) send({ batch: exposures });
          document.dispatchEvent(new CustomEvent('omni:variants', { detail: assigned }));
        })
        .catch(function () {
          /* pas d'expérience en cours, ou agence injoignable : la page continue */
        });
    } catch (error) {
      /* idem */
    }
  }

  /* ---------------------------------------------------------------- */
  /* Interface publique                                                */
  /* ---------------------------------------------------------------- */

  window.omni = track;
  window.omni.variant = function (key) {
    return assigned[key] || null;
  };
  window.omni.variants = function () {
    return assigned;
  };
  window.omni.identify = function () {
    // Volontairement absent : ce mouchard ne relie pas les événements à une
    // personne. L'identité appartient au produit, pas à la mesure.
    console.warn('[omni] identify n’existe pas : la mesure reste anonyme.');
  };

  /* Page vue, y compris sur les navigations d'une application à page unique. */
  track('$pageview');

  var lastPath = location.pathname;
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    history[method] = function () {
      var result = original.apply(this, arguments);
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        track('$pageview');
      }
      return result;
    };
  });
  window.addEventListener('popstate', function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      track('$pageview');
    }
  });

  loadExperiments();
})();
