import { buffer } from "micro";
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { resolvePlan } from "./_lib/price-map.js";

async function persistActiveSubscription({
  admin,
  userId,
  customerId,
  subscriptionId,
  priceId,
}) {
  const plan = resolvePlan(priceId);
  if (!plan || !userId) return;

  const patch = {
    id: userId,
    stripe_customer_id: typeof customerId === "string" ? customerId : null,
    stripe_subscription_id:
      typeof subscriptionId === "string" ? subscriptionId : null,
    plan,
  };

  await admin.from("users").upsert(patch, { onConflict: "id" });
}

async function persistCanceled(admin, subscription) {
  const userId =
    subscription.metadata?.supabase_user_id || subscription.metadata?.user_id;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  if (userId) {
    const { data: existing } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();

    await admin.from("users").upsert(
      {
        id: userId,
        stripe_customer_id:
          (typeof customerId === "string" && customerId) ||
          existing?.stripe_customer_id ||
          null,
        stripe_subscription_id: null,
        plan: null,
      },
      { onConflict: "id" }
    );
    return;
  }

  if (typeof customerId === "string") {
    await admin
      .from("users")
      .update({
        stripe_subscription_id: null,
        plan: null,
      })
      .eq("stripe_customer_id", customerId);
  }
}

function priceIdFromStripeSubscription(subscription) {
  const item = subscription?.items?.data?.[0]?.price;
  const id = typeof item?.id === "string" ? item.id : null;
  return id;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const whSecret =
    process.env.STRIPE_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET;
  const secret = process.env.STRIPE_SECRET_KEY?.trim();

  if (!whSecret || !secret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY");
    res.status(500).send("Server misconfiguration");
    return;
  }

  const stripe = new Stripe(secret);

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const buf =
      Buffer.isBuffer(req.body) ?
        req.body
      : await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, whSecret);
  } catch (e) {
    console.error("stripe webhook signature", e);
    res.status(400).send(`Webhook Error: ${e.message}`);
    return;
  }

  try {
    const admin = supabaseAdmin();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;

        const userId =
          session.metadata?.supabase_user_id ||
          session.client_reference_id ||
          null;

        const priceIdHint =
          typeof session.metadata?.price_id === "string" ?
            session.metadata.price_id
          : null;

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id || null;

        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id || null;

        let priceId = priceIdHint;

        if (subId && (!priceId || !resolvePlan(priceId))) {
          const sub = await stripe.subscriptions.retrieve(subId, {
            expand: ["items.data.price"],
          });
          priceId = priceIdFromStripeSubscription(sub);
        }

        if (userId && customerId && subId && priceId) {
          await persistActiveSubscription({
            admin,
            userId,
            customerId,
            subscriptionId: subId,
            priceId,
          });
        }

        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object;
        const status = subscription.status;
        const userId =
          subscription.metadata?.supabase_user_id ||
          subscription.metadata?.user_id ||
          null;

        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id || null;

        const priceId = priceIdFromStripeSubscription(subscription);

        const activeStatuses = ["active", "trialing"];

        if (userId && priceId && activeStatuses.includes(status)) {
          await persistActiveSubscription({
            admin,
            userId,
            customerId,
            subscriptionId: subscription.id,
            priceId,
          });
          break;
        }

        const terminal = ["canceled", "unpaid", "incomplete_expired"];

        if (terminal.includes(status)) {
          await persistCanceled(admin, subscription);
        }
        break;
      }
      case "customer.subscription.deleted": {
        await persistCanceled(admin, event.data.object);
        break;
      }
      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error("webhook handler", e);
    res.status(500).json({ error: e.message });
  }
}
