import type { APIRoute } from 'astro';

export const prerender = false;

interface GenerateRequestBody {
  name?: string;
  niche?: string;
  type?: 'saas' | 'dropship' | 'affiliate' | 'ebook' | 'viral_campaign';
  businessModel?: 'trial_rebill' | 'freemium' | 'one_time' | 'affiliate_commission';
  priceTrial?: number;
  priceRecurring?: number;
  trialHours?: number;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as GenerateRequestBody;
    const { name, niche, type, businessModel, priceTrial, priceRecurring, trialHours } = body;

    // Simulate Agent Task Graph computation
    const slug = (name || 'venture').toLowerCase().replace(/[^a-z0-9]/g, '-');

    const generatedVenture = {
      id: `vnt-${Date.now()}`,
      name: name || 'Nouveau SaaS',
      slug,
      niche: niche || 'Général',
      type: type || 'saas',
      businessModel: businessModel || 'trial_rebill',
      status: 'canary',
      domain: `${slug}.factory.dev`,
      stripeAccountId: 'acct_1NvXAutoStripe',
      priceTrialCents: Math.round((priceTrial || 0.50) * 100),
      priceRecurringCents: Math.round((priceRecurring || 39.00) * 100),
      trialDurationHours: trialHours || 48,
      canaryTrafficPct: 10,
      activeVersion: 'v1.0.0-canary',
      visitorsCount: 0,
      subscribersCount: 0,
      mrrCents: 0,
      totalRevenueCents: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return new Response(JSON.stringify({
      success: true,
      venture: generatedVenture,
      message: `Venture "${generatedVenture.name}" générée et déployée en Canary sur Cloudflare Edge !`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
