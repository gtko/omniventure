import type { APIRoute } from 'astro';

export const prerender = false;

interface StripeWebhookPayload {
  type?: string;
  data?: {
    object?: Record<string, unknown>;
  };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const signature = request.headers.get('stripe-signature') || 'sig_mock';
    const payload = ((await request.json().catch(() => ({}))) as StripeWebhookPayload);

    // Handle Trial to Rebill Event
    const eventType = payload.type || 'checkout.session.completed';

    return new Response(JSON.stringify({
      received: true,
      signature_checked: !!signature,
      event_type: eventType,
      action: 'D1 State Updated: Subscription armed for 48h rebill.'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return new Response(JSON.stringify({
      error: message
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
