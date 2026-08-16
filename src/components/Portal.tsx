import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Attache son contenu au <body> au lieu de le laisser dans le flux.
 *
 * Indispensable pour les modales ouvertes depuis la barre latérale : `.app-nav`
 * porte un `backdrop-filter`, et une propriété de filtrage fait de l'élément un
 * bloc conteneur pour ses descendants en `position: fixed`. Sans portail, une
 * modale « plein écran » reste donc enfermée dans les 16 rem de la barre.
 */
export const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mounted, setMounted] = useState(false);

  // Le portail a besoin du DOM : on attend le montage côté navigateur.
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  // `data-portal-modal` sert d'accroche CSS : attaché au <body>, le contenu
  // hériterait sinon de l'encre claire du thème immersif sur un panneau blanc.
  return createPortal(<div data-portal-modal>{children}</div>, document.body);
};
