import React, { useState, useEffect } from 'react';
import { getStoredVentures, getActiveProjectId } from '../lib/store';
import type { Venture, MediaAsset } from '../types';

const DEFAULT_SAMPLE_ASSET: MediaAsset = {
  id: 'med-sample',
  ventureId: 'vnt-01',
  ventureName: 'Mon Premier Micro-SaaS',
  assetType: 'tiktok_9_16',
  title: 'Hook Viral TikTok : Démonstration Rapide',
  videoScript: 'POV: Tu passes encore 3 heures sur des tâches manuelles alors qu\'un outil à 0.50$ fait tout en 10 secondes.',
  audioTtsVoice: 'fr-FR (Voix Réelle Navigateur)',
  mediaUrl: '',
  modelUsed: 'MiniMax Hailuo + FFmpeg',
  durationSeconds: 15,
  status: 'ready',
  viewsCount: 0,
  clicksCount: 0,
  createdAt: new Date().toISOString()
};

export const MediaViralStudio: React.FC = () => {
  const [activeVenture, setActiveVenture] = useState<Venture | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([DEFAULT_SAMPLE_ASSET]);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset>(DEFAULT_SAMPLE_ASSET);
  const [scriptHook, setScriptHook] = useState<string>(
    'POV: Ton client te demande un contrat à minuit mais tu es déjà au lit... Voici comment je le génère en 10s.'
  );
  const [videoModel, setVideoModel] = useState<string>('MiniMax Hailuo');
  const [ttsVoice, setTtsVoice] = useState<string>('fr-FR');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    const list = getStoredVentures();
    const activeId = getActiveProjectId();
    const found = list.find(v => v.id === activeId) || list[0];
    if (found) {
      setActiveVenture(found);
      const initial: MediaAsset = {
        id: `med-${found.id}`,
        ventureId: found.id,
        ventureName: found.name,
        assetType: 'tiktok_9_16',
        title: `${found.name} : Hook Viral TikTok`,
        videoScript: `POV: Tu perds encore du temps sur ${found.niche}... Alors que ${found.name} s'en occupe en 1-clic pour 0.50$.`,
        audioTtsVoice: 'fr-FR (Voix Réelle)',
        mediaUrl: '',
        modelUsed: 'MiniMax Video + Edge-TTS',
        durationSeconds: 15,
        status: 'ready',
        viewsCount: 0,
        clicksCount: 0,
        createdAt: new Date().toISOString()
      };
      setAssets([initial]);
      setSelectedAsset(initial);
      setScriptHook(initial.videoScript || '');
    }
  }, []);

  const handleGenerateVideo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVenture) return;
    setIsGenerating(true);

    setTimeout(() => {
      const newAsset: MediaAsset = {
        id: `med-${Date.now()}`,
        ventureId: activeVenture.id,
        ventureName: activeVenture.name,
        assetType: 'tiktok_9_16',
        title: `${activeVenture.name} : Clip TikTok 9:16`,
        videoScript: scriptHook,
        audioTtsVoice: `${ttsVoice} (TTS)`,
        mediaUrl: '',
        modelUsed: `${videoModel} + FFmpeg`,
        durationSeconds: 18,
        status: 'ready',
        viewsCount: 0,
        clicksCount: 0,
        createdAt: new Date().toISOString()
      };

      setAssets([newAsset, ...assets]);
      setSelectedAsset(newAsset);
      setIsGenerating(false);
      setNotification('Vidéo TikTok 9:16 générée avec succès !');
      setTimeout(() => setNotification(null), 3000);
    }, 1200);
  };

  // Real Web Speech Synthesis for narration
  const handlePlayVoiceNarration = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setNotification('Synthèse vocale non supportée par votre navigateur.');
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (isPlayingAudio) {
      window.speechSynthesis.cancel();
      setIsPlayingAudio(false);
      return;
    }

    const textToSpeak = selectedAsset?.videoScript || scriptHook;
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = ttsVoice.includes('en') ? 'en-US' : 'fr-FR';
    utterance.rate = 1.05;

    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);

    setIsPlayingAudio(true);
    window.speechSynthesis.speak(utterance);
  };

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
          <h1 className="text-2xl font-bold text-slate-900">Studio Vidéo TikTok & Shorts (9:16)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Génération automatisée de vidéos courtes avec voix off TTS pour <strong className="text-slate-800">{activeVenture?.name || 'votre projet'}</strong>.
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Generator Form */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-base">Générateur de Vidéos Virales</h3>

          <form onSubmit={handleGenerateVideo} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Projet Cible</label>
              <input
                type="text"
                disabled
                value={activeVenture ? `${activeVenture.name} (${activeVenture.type.toUpperCase()})` : 'Aucun projet sélectionné'}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-700 font-medium"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Moteur Vidéo Économique</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'MiniMax Hailuo', label: 'MiniMax Hailuo', cost: '~$0.06/clip' },
                  { id: 'Seedance Video', label: 'Seedance Video', cost: '~$0.04/clip' }
                ].map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setVideoModel(m.id)}
                    className={`p-2.5 rounded-lg border text-left transition-colors ${
                      videoModel === m.id
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-semibold text-xs">{m.label}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{m.cost}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Langue & Voix Off (TTS)</label>
              <select
                value={ttsVoice}
                onChange={e => setTtsVoice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-indigo-600"
              >
                <option value="fr-FR">Français (Voix Naturelle)</option>
                <option value="en-US">English US (Natural Voice)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Script & Accroche (Hook 0-3s)</label>
              <textarea
                rows={3}
                required
                value={scriptHook}
                onChange={e => setScriptHook(e.target.value)}
                placeholder="Écrivez le script de votre clip vidéo..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:border-indigo-600 leading-relaxed"
              />
            </div>

            <button
              type="submit"
              disabled={isGenerating}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              {isGenerating ? 'Génération du Clip Vidéo en cours...' : 'Générer le Clip TikTok (9:16)'}
            </button>
          </form>
        </div>

        {/* Player Simulator & Library */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center gap-6">
            
            {/* Mobile Screen Mockup */}
            <div className="w-56 h-88 rounded-2xl bg-slate-900 border-2 border-slate-300 relative overflow-hidden shadow-md flex flex-col justify-between p-4 flex-shrink-0 text-white">
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                <span>Pour toi</span>
                <span className="text-red-400">● LIVE</span>
              </div>

              <div className="my-auto text-center space-y-3">
                <button
                  onClick={handlePlayVoiceNarration}
                  className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center text-base shadow-lg transition-transform ${
                    isPlayingAudio ? 'bg-indigo-600 text-white scale-110 animate-pulse' : 'bg-white/20 hover:bg-white/30 text-white'
                  }`}
                  title="Écouter la voix off en direct"
                >
                  {isPlayingAudio ? '⏹' : '▶'}
                </button>
                <div className="px-2.5 py-0.5 rounded bg-yellow-400 text-slate-900 font-bold text-[10px] uppercase inline-block">
                  OFFRE FLASH 0.50$
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-bold text-white">
                  @{selectedAsset ? selectedAsset.ventureName.toLowerCase().replace(/[^a-z0-9]/g, '') : 'saas'}
                </div>
                <p className="text-[11px] text-slate-300 line-clamp-3 leading-snug">
                  {selectedAsset?.videoScript || scriptHook}
                </p>
              </div>
            </div>

            {/* Details and Controls */}
            <div className="space-y-4 text-xs w-full">
              <div>
                <span className="text-slate-500 font-semibold block text-[11px]">Clip Sélectionné</span>
                <h4 className="text-base font-bold text-slate-900 mt-0.5">{selectedAsset?.title || 'Clip Vidéo'}</h4>
                <p className="text-slate-600 mt-1 leading-relaxed">{selectedAsset?.videoScript || scriptHook}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePlayVoiceNarration}
                  className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <span>{isPlayingAudio ? '⏹ Arrêter l\'Audio' : '🔊 Écouter la Voix Off'}</span>
                </button>
              </div>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-slate-600">
                <div className="flex justify-between">
                  <span>Moteur de Rendu :</span>
                  <span className="font-semibold text-slate-900">{selectedAsset?.modelUsed || 'MiniMax Video'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Voix de Narration :</span>
                  <span className="font-semibold text-slate-900">{selectedAsset?.audioTtsVoice || 'fr-FR'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Format :</span>
                  <span className="font-semibold text-slate-900">Vertical 9:16 (1080x1920)</span>
                </div>
              </div>
            </div>

          </div>

          {/* Library */}
          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 text-sm">Clips Générés ({assets.length})</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {assets.map(a => (
                <button
                  key={a.id}
                  onClick={() => {
                    setSelectedAsset(a);
                    setScriptHook(a.videoScript || '');
                  }}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    selectedAsset?.id === a.id
                      ? 'bg-indigo-50 border-indigo-600'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">{a.ventureName}</span>
                    <span className="text-[10px] text-slate-500 font-mono">Format 9:16</span>
                  </div>
                  <p className="text-slate-500 text-xs mt-1 line-clamp-1">{a.title}</p>
                </button>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
