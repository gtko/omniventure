import React, { useState, useEffect } from 'react';
import { getStoredVentures, getActiveProjectId } from '../lib/store';
import type { Venture } from '../types';

export const MarketingAcquisitionStudio: React.FC = () => {
  const [activeVenture, setActiveVenture] = useState<Venture | null>(null);
  const [activeTab, setActiveTab] = useState<'ads' | 'seo_blog' | 'organic_social' | 'image_prompts'>('ads');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Generated Outputs State
  const [adCopy, setAdCopy] = useState({
    metaHeadline: 'Générez vos contrats freelances en 10 secondes avec l\'IA',
    metaBody: 'Arrêtez de perdre des heures sur des templates Word dépassés. Obtenez un contrat légal et conforme RGPD instantanément pour 0.50$ seulement.',
    googleHeadlines: ['Contrat Freelance en 10s', 'Générateur Juridique IA', 'Essai Flash à 0.50$'],
    googleDescriptions: ['Créez vos NDA et contrats sans avocat. Conforme RGPD 2026. Testez 48h pour 0.50$.'],
    tiktokHook: 'POV: Ton client veut un contrat à minuit mais tu es dans ton lit...'
  });

  const [seoArticle, setSeoArticle] = useState({
    title: 'Comment rédiger un contrat de freelance conforme en 2026 sans avocat ?',
    metaDescription: 'Découvrez les 5 clauses indispensables d\'un contrat freelance et comment automatiser leur rédaction en 10 secondes grâce à l\'IA.',
    contentPreview: `## 1. Pourquoi le contrat écrit est indispensable pour tout indépendant ?\nEn 2026, plus de 42% des litiges freelances concernent des factures impayées ou un périmètre de mission flou. Avoir un contrat solide n'est plus une option mais une assurance...\n\n## 2. Les 5 clauses obligatoires à inclure impérativement\n- Clause 1 : Description détaillée des livrables et jalons.\n- Clause 2 : Modalités de règlement et pénalités de retard.\n- Clause 3 : Cession des droits de propriété intellectuelle après paiement.\n- Clause 4 : Clause de confidentialité et protection des données (RGPD).\n- Clause 5 : Conditions de résiliation anticipée.\n\n## 3. Automatisez la rédaction en 10 secondes\nGrâce aux nouveaux outils d'IA comme DocuSignAI Pro, vous pouvez générer un contrat sur-mesure pour seulement 0.50$...`
  });

  const [socialPosts, setSocialPosts] = useState({
    twitterThread: `🧵 Comment j'ai divisé par 10 le temps de rédaction de mes contrats de freelance (et sécurisé 100% de mes paiements) :\n\n1/ Avant, j'utilisais des templates Word trouvés sur Google...\n2/ Résultat : 2 clients ont refusé de payer en invoquant un flou juridique.\n3/ Maintenant, j'utilise un générateur IA qui adapte les clauses en 10s.\n\nLien dans le tweet suivant 👇`,
    linkedinPost: `💼 Freelances & Agences : Vos contrats vous protègent-ils vraiment en 2026 ?\n\nJ'ai analysé 50 modèles de contrats disponibles gratuitement en ligne.\nVerdict : 78% ne sont pas à jour sur les règles de cession de droits IA et RGPD.\n\nVoici les 3 vérifications à faire impérativement avant d'envoyer votre prochain devis...`,
    redditPost: `[Partage d'expérience] Comment je gère mes contrats sans payer 800€ d'avocat à chaque mission freelance.`
  });

  const [imagePrompts, setImagePrompts] = useState({
    bannerPrompt: 'Clean minimalist 3D isometric illustration of a digital contract document signed with glowing blue pen, sleek glass desk, professional lighting, 8k render --ar 16:9',
    socialPostPrompt: 'Modern high-converting SaaS dashboard interface showing real-time legal contract generation, clean typography, soft shadows, Apple UI aesthetic --ar 1:1',
    tiktokBackgroundPrompt: 'Cinematic dynamic footage of a freelancer working on laptop at night, focused expression, neon subtle blue ambiance --ar 9:16'
  });

  useEffect(() => {
    const list = getStoredVentures();
    const activeId = getActiveProjectId();
    const found = list.find(v => v.id === activeId) || list[0];
    if (found) setActiveVenture(found);
  }, []);

  const handleRegenerate = () => {
    if (!activeVenture) return;
    setIsGenerating(true);

    setTimeout(() => {
      setAdCopy({
        metaHeadline: `Découvrez ${activeVenture.name} : Solution n°1 pour ${activeVenture.niche}`,
        metaBody: `Automatisez votre travail dès aujourd'hui. Profitez de l'offre spéciale d'essai à 0.50$ pendant 48h.`,
        googleHeadlines: [`${activeVenture.name} Officiel`, 'Essai Flash 0.50$', 'Automatisation en 1-Clic'],
        googleDescriptions: [`Gagnez du temps sur ${activeVenture.niche}. Conforme et sécurisé. Testez pour 0.50$.`],
        tiktokHook: `Ce site secret va révolutionner votre quotidien sur ${activeVenture.niche}...`
      });

      setIsGenerating(false);
      setNotification(`Campagne marketing et contenus regénérés pour "${activeVenture.name}".`);
      setTimeout(() => setNotification(null), 3500);
    }, 1000);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setNotification('Texte copié dans le presse-papier !');
    setTimeout(() => setNotification(null), 2500);
  };

  if (!activeVenture) {
    return (
      <div className="bg-white p-12 rounded-xl border border-slate-200 text-center space-y-4 max-w-lg mx-auto my-12">
        <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto text-xl font-bold">
          📢
        </div>
        <h2 className="text-lg font-bold text-slate-900">Aucun projet sélectionné</h2>
        <p className="text-sm text-slate-500">
          Veuillez sélectionner ou créer un projet dans la barre latérale pour générer ses publicités, articles SEO et contenus sociaux.
        </p>
        <a
          href="/ventures"
          className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg shadow-sm"
        >
          Voir mes business
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-lg shadow-lg text-xs flex items-center gap-2">
          <span>✓</span>
          <span>{notification}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Acquisition & Machine Marketing 360°</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Génération automatique de Publicités (Meta/Google/TikTok), Articles SEO, Posts Réseaux Sociaux et Visuels pour <strong className="text-slate-800">{activeVenture?.name || 'votre projet'}</strong>.
          </p>
        </div>

        <button
          onClick={handleRegenerate}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors disabled:opacity-50"
        >
          <span>⚡</span>
          <span>{isGenerating ? 'Génération en cours...' : 'Régénérer toute la Campagne'}</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white p-1 rounded-xl shadow-xs">
        {[
          { id: 'ads', label: '🎯 Publicités Ads (Meta, Google, TikTok)' },
          { id: 'seo_blog', label: '✍️ Articles SEO & Blog' },
          { id: 'organic_social', label: '📱 Posts Organiques (X, LinkedIn, Reddit)' },
          { id: 'image_prompts', label: '🎨 Prompts Images & Bannières' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === tab.id
                ? 'bg-indigo-50 text-indigo-700 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Paid Ads Engine */}
      {activeTab === 'ads' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Meta Ads */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Publicité Meta (Facebook & Instagram)</h3>
              <button onClick={() => copyToClipboard(`${adCopy.metaHeadline}\n\n${adCopy.metaBody}`)} className="text-xs text-indigo-600 hover:underline">Copier</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 font-semibold block mb-1">Titre Accrocheur (Headline) :</span>
                <p className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-semibold">{adCopy.metaHeadline}</p>
              </div>
              <div>
                <span className="text-slate-500 font-semibold block mb-1">Texte Principal (Body Copy) :</span>
                <p className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 leading-relaxed">{adCopy.metaBody}</p>
              </div>
              <div>
                <span className="text-slate-500 font-semibold block mb-1">Appel à l'action (CTA) :</span>
                <span className="px-3 py-1 bg-indigo-600 text-white rounded font-semibold text-xs inline-block">Essayer pour 0.50$</span>
              </div>
            </div>
          </div>

          {/* Google Ads & TikTok Spark Ads */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Google Search Ads & TikTok Spark Ads</h3>
              <button onClick={() => copyToClipboard(adCopy.googleHeadlines.join(' | '))} className="text-xs text-indigo-600 hover:underline">Copier</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 font-semibold block mb-1">Titres Google Ads (Responsive Search) :</span>
                <div className="space-y-1">
                  {adCopy.googleHeadlines.map((h, i) => (
                    <div key={i} className="p-2 bg-slate-50 border border-slate-200 rounded text-slate-900 font-medium">
                      {h}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-slate-500 font-semibold block mb-1">Hook Vidéo TikTok Ads (0-3s) :</span>
                <p className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-mono text-[11px]">{adCopy.tiktokHook}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: SEO Blog Article */}
      {activeTab === 'seo_blog' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-base">{seoArticle.title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Meta-description : {seoArticle.metaDescription}</p>
            </div>
            <button onClick={() => copyToClipboard(seoArticle.contentPreview)} className="px-3.5 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg">
              Copier l'Article Complet
            </button>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {seoArticle.contentPreview}
          </div>
        </div>
      )}

      {/* Tab 3: Organic Social Media Posts */}
      {activeTab === 'organic_social' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Twitter Thread */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="font-bold text-slate-900 text-xs">🧵 Thread X (Twitter)</span>
              <button onClick={() => copyToClipboard(socialPosts.twitterThread)} className="text-xs text-indigo-600 hover:underline">Copier</button>
            </div>
            <p className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed font-sans">
              {socialPosts.twitterThread}
            </p>
          </div>

          {/* LinkedIn Post */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="font-bold text-slate-900 text-xs">💼 Post LinkedIn</span>
              <button onClick={() => copyToClipboard(socialPosts.linkedinPost)} className="text-xs text-indigo-600 hover:underline">Copier</button>
            </div>
            <p className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed font-sans">
              {socialPosts.linkedinPost}
            </p>
          </div>

          {/* Reddit Post */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="font-bold text-slate-900 text-xs">💬 Post Reddit</span>
              <button onClick={() => copyToClipboard(socialPosts.redditPost)} className="text-xs text-indigo-600 hover:underline">Copier</button>
            </div>
            <p className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed font-sans">
              {socialPosts.redditPost}
            </p>
          </div>
        </div>
      )}

      {/* Tab 4: Image & Visual Prompts */}
      {activeTab === 'image_prompts' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2 text-xs">
              <span className="font-bold text-slate-900 block">Bannière Publicitaire (16:9)</span>
              <p className="p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed">
                {imagePrompts.bannerPrompt}
              </p>
              <button onClick={() => copyToClipboard(imagePrompts.bannerPrompt)} className="text-xs text-indigo-600 font-semibold hover:underline">Copier le Prompt Midjourney/Flux</button>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2 text-xs">
              <span className="font-bold text-slate-900 block">Visuel Carré Social Media (1:1)</span>
              <p className="p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed">
                {imagePrompts.socialPostPrompt}
              </p>
              <button onClick={() => copyToClipboard(imagePrompts.socialPostPrompt)} className="text-xs text-indigo-600 font-semibold hover:underline">Copier le Prompt Midjourney/Flux</button>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2 text-xs">
              <span className="font-bold text-slate-900 block">Arrière-Plan Vidéo TikTok (9:16)</span>
              <p className="p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-800 leading-relaxed">
                {imagePrompts.tiktokBackgroundPrompt}
              </p>
              <button onClick={() => copyToClipboard(imagePrompts.tiktokBackgroundPrompt)} className="text-xs text-indigo-600 font-semibold hover:underline">Copier le Prompt Midjourney/Flux</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
