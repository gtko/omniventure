import React, { useState, useRef, useEffect } from 'react';

export interface OpenRouterModelItem {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

interface Props {
  value: string;
  onChange: (modelId: string) => void;
  models: OpenRouterModelItem[];
  isLoading?: boolean;
  placeholder?: string;
}

export const ModelCombobox: React.FC<Props> = ({
  value,
  onChange,
  models,
  isLoading = false,
  placeholder = 'Rechercher un modèle (ex: deepseek, claude, grok, gemini...)'
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredModels = models.filter(m => {
    const term = searchTerm.toLowerCase();
    return m.id.toLowerCase().includes(term) || (m.name && m.name.toLowerCase().includes(term));
  });

  const selectedModel = models.find(m => m.id === value);

  return (
    <div ref={wrapperRef} className="relative w-full text-xs">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <input
            type="text"
            value={isOpen ? searchTerm : (selectedModel ? `${selectedModel.name || selectedModel.id} (${selectedModel.id})` : value)}
            onFocus={() => {
              setSearchTerm('');
              setIsOpen(true);
            }}
            onChange={e => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
            }}
            placeholder={isLoading ? 'Chargement des modèles OpenRouter...' : placeholder}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 font-mono text-xs focus:bg-white focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
          />
          {value && !isOpen && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchTerm('');
                setIsOpen(true);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[10px]"
            >
              ▼
            </button>
          )}
        </div>
      </div>

      {/* Dropdown Menu List */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl divide-y divide-slate-100">
          {isLoading ? (
            <div className="p-4 text-center text-slate-500 text-xs">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-1"></div>
              Récupération des modèles depuis OpenRouter API...
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="p-3 text-slate-500 text-center text-xs space-y-1">
              <div>Aucun modèle trouvé pour "{searchTerm}".</div>
              <button
                type="button"
                onClick={() => {
                  onChange(searchTerm);
                  setIsOpen(false);
                }}
                className="text-indigo-600 font-semibold hover:underline block mx-auto text-[11px]"
              >
                Utiliser l'identifiant personnalisé : <strong>{searchTerm}</strong>
              </button>
            </div>
          ) : (
            filteredModels.slice(0, 50).map(m => {
              const isSelected = m.id === value;
              const promptCost = m.pricing?.prompt ? (parseFloat(m.pricing.prompt) * 1000000).toFixed(2) : null;

              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setIsOpen(false);
                  }}
                  className={`w-full p-2.5 text-left flex items-center justify-between hover:bg-indigo-50/60 transition-colors ${
                    isSelected ? 'bg-indigo-50 font-semibold text-indigo-900' : 'text-slate-700'
                  }`}
                >
                  <div className="space-y-0.5 truncate pr-2">
                    <div className="font-semibold text-slate-900 text-xs truncate">
                      {m.name || m.id}
                    </div>
                    <div className="font-mono text-[10px] text-slate-500 truncate">
                      {m.id}
                    </div>
                  </div>

                  <div className="text-right font-mono text-[10px] text-slate-400 flex-shrink-0">
                    {promptCost ? (
                      <span className="text-emerald-700 font-medium">
                        ${promptCost}/1M
                      </span>
                    ) : (
                      <span>OpenRouter</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
