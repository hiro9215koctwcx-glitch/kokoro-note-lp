import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import { allowedPriceIds, resolvePlan } from "./_lib/price-map.js";
import { appOrigin } from "./_lib/origin.js";

function parseJsonBody(req) {
  const raw = req.body;
  if (raw == null) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return {};
    }
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) {
      res.status(401).json({ error: "ログインが必要です" });
      return;
    }

    const admin = supabaseAdmin();
    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(token);

    if (userErr || !user) {
      res.status(401).json({ error: "ログインが必要です" });
      return;
    }

    const body = parseJsonBody(req);
    const priceId =
      typeof body.priceId === "string" ? body.priceId.trim() : "";

    if (!allowedPriceIds().has(priceId)) {
      res.status(400).json({ error: "無効な価格です" });
      return;
    }

    const plan = resolvePlan(priceId);
    if (!plan) {
      res.status(400).json({ error: "無効な価格です" });
      return;
    }

    const secret = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secret) {
      res.status(500).json({ error: "Stripe が設定されていません" });
      return;
    }

    const stripe = new Stripe(secret);

    const { data: row } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const existingCustomer =
      typeof row?.stripe_customer_id === "string"
        ? row.stripe_customer_id
        : null;

    const origin = appOrigin(req);
    const successUrl = `${origin}/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/cancel`;

    /** @type {import("stripe").Stripe.Checkout.SessionCreateParams} */
    const params = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        price_id: priceId,
        plan,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          price_id: priceId,
          plan,
        },
      },
    };

    const email =
      typeof user.email === "string" && user.email.includes("@")
        ? user.email
        : undefined;

    if (existingCustomer) {
      params.customer = existingCustomer;
    } else if (email) {
      params.customer_email = email;
    } else {
      res.status(400).json({
        error:
          "アカウントにメールアドレスが必要です（Supabase Auth のユーザーにメールを設定してください）",
      });
      return;
    }

    const session = await stripe.checkout.sessions.create(params);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("create-checkout-session", e);
    res.status(500).json({
      error:
        typeof e.message === "string" ? e.message : "チェックアウトの開始に失敗しました",
    });
  }
}
