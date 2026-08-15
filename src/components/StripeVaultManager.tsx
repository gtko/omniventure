import React, { useState } from 'react';

interface StripeAccount {
  id: string;
  label: string;
  type: 'saas_primary' | 'ecom_dropship' | 'affiliate_vault';
  status: 'active' | 'restricted' | 'standby';
  currency: string;
  volumeMtdCents: number;
  activeSubscriptions: number;
  dunningRatePct: number;
}

export const StripeVaultManager: React.FC = () => {
  const [accounts] = useState<StripeAccount[]>([
    {
      id: 'acct_1NvX99StripePrimary',
      label: 'Stripe SaaS Hub (DocuSignAI & Micro-SaaS)',
      type: 'saas_primary',
      status: 'active',
      currency: 'USD ($)',
      volumeMtdCents: 1497600,
      activeSubscriptions: 384,
      dunningRatePct: 94.2
    },
    {
      id: 'acct_1NvX88StripeEcom',
      label: 'Stripe Dropshipping (AuraLum Guard)',
      type: 'ecom_dropship',
      status: 'active',
      currency: 'EUR (€)',
      volumeMtdCents: 1072850,
      activeSubscriptions: 0,
      dunningRatePct: 98.1
    },
    {
      id: 'acct_1NvX77StripeReserve',
      label: 'Stripe Fallback & Reserve (Anti-Ban)',
      type: 'affiliate_vault',
      status: 'standby',
      currency: 'USD ($)',
      volumeMtdCents: 240000,
      activeSubscriptions: 52,
      dunningRatePct: 96.0
    }
  ]);

  const [webhookLogs, setWebhookLogs] = useState<string[]>([
    'Stripe Webhook: checkout.session.completed (Customer: cus_Q8891, Amount: $0.50, Trial: 48h)',
    'Stripe Webhook: invoice.paid (Subscription: sub_K7712, Amount: $39.00, Rebill 48h OK)',
    'Stripe Webhook: setup_intent.succeeded (Payment Method attached: pm_card_visa)'
  ]);

  const [isTestingWebhook, setIsTestingWebhook] = useState<boolean>(false);

  const handleTestWebhook = () => {
    setIsTestingWebhook(true);
    setTimeout(() => {
      setWebhookLogs(prev => [
        `[TEST] customer.subscription.created (Trial $0.50 -> Rebill 48h armé)`,
        ...prev
      ]);
      setIsTestingWebhook(false);
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stripe Vault & Monétisation</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Comptes marchands connectés, suivi des transitions Trial 0.50$ → Rebill 48h et relances dunning.
          </p>
        </div>

        <button
          onClick={handleTestWebhook}
          disabled={isTestingWebhook}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-lg shadow-sm transition-colors disabled:opacity-50"
        >
          <span>⚡</span>
          <span>{isTestingWebhook ? 'Envoi...' : 'Tester Webhook Stripe 48h'}</span>
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Accounts */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Comptes Stripe Marchands ({accounts.length})</h3>

          <div className="space-y-3">
            {accounts.map(acc => (
              <div key={acc.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{acc.label}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                        acc.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}>
                        {acc.status}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 font-mono">{acc.id} • {acc.currency}</span>
                  </div>

                  <div className="text-right">
                    <div className="text-base font-bold text-slate-900">
                      ${(acc.volumeMtdCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-slate-400">Volume ce mois</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-xs">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 block text-[11px]">Abonnements</span>
                    <span className="font-bold text-slate-900">{acc.activeSubscriptions}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 block text-[11px]">Succès Rebill 48h</span>
                    <span className="font-bold text-emerald-700">{acc.dunningRatePct}%</span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-slate-500 block text-[11px]">Smart Dunning</span>
                    <span className="font-bold text-indigo-700">3 relances</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Webhooks Feed */}
        <div className="space-y-4">
          <h3 className="font-bold text-slate-900 text-sm">Journal des Webhooks Stripe</h3>

          <div className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-xs space-y-2 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-slate-400">
              <span>Webhook Listener Edge</span>
              <span className="text-emerald-400 text-[10px]">200 OK</span>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {webhookLogs.map((log, idx) => (
                <div key={idx} className="p-2.5 rounded-lg bg-slate-800 text-slate-300 leading-relaxed text-[11px]">
                  <span className="text-emerald-400 font-bold block mb-0.5">❯ Événement Stripe</span>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
