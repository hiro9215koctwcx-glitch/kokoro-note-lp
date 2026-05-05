import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.14";

async function loadSupabase() {
  const r = await fetch("/api/env-public");
  const cfg = await r.json();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    console.error(cfg.error || "Supabase が未設定です");
    return null;
  }
  return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

const authDialog = /** @type {HTMLDialogElement | null} */ (
  document.getElementById("auth-dialog")
);
const authBarGuest = /** @type {HTMLElement | null} */ (
  document.getElementById("auth-bar-guest")
);
const authBarUser = /** @type {HTMLElement | null} */ (
  document.getElementById("auth-bar-user")
);
const authEmailSpan = authBarUser?.querySelector(".auth-email");
const openAuthBtn = document.getElementById("open-auth");
const signOutBtn = document.getElementById("sign-out-btn");
const authModeToggle = /** @type {HTMLElement | null} */ (
  document.getElementById("auth-mode-toggle")
);
const authFormTitle = /** @type {HTMLElement | null} */ (
  document.getElementById("auth-form-title")
);
const authSubmitBtn = /** @type {HTMLElement | null} */ (
  document.getElementById("auth-submit-btn")
);
const authForm = /** @type {HTMLFormElement | null} */ (
  document.getElementById("auth-form")
);
const authError = /** @type {HTMLElement | null} */ (
  document.getElementById("auth-error")
);

/** @type {"login"|"signup"} */
let authMode = "login";
/** @type {string|null} */
let pendingCheckoutPriceId = null;
let supabase = /** @type {ReturnType<typeof createClient>|null} */ (null);

function setAuthMode(mode) {
  authMode = mode;
  if (authFormTitle && authSubmitBtn && authModeToggle) {
    if (mode === "login") {
      authFormTitle.textContent = "ログイン";
      authSubmitBtn.textContent = "ログイン";
      authModeToggle.textContent = "アカウントがない場合は新規作成";
      authModeToggle.dataset.next = "signup";
    } else {
      authFormTitle.textContent = "新規アカウント作成";
      authSubmitBtn.textContent = "登録して続ける";
      authModeToggle.textContent = "すでにアカウントがある場合はログイン";
      authModeToggle.dataset.next = "login";
    }
  }
}

authModeToggle?.addEventListener("click", () => {
  const next = authModeToggle.dataset.next === "signup" ? "signup" : "login";
  setAuthMode(next);
});

function renderAuth(session) {
  const has = !!(session?.user?.id);
  if (authBarGuest) authBarGuest.hidden = has;
  if (authBarUser) authBarUser.hidden = !has;
  const email =
    typeof session?.user?.email === "string" ? session.user.email : "";
  if (authEmailSpan && email) authEmailSpan.textContent = email;
}

async function startCheckout(priceId) {
  const client = supabase;
  if (!client || !priceId.startsWith("price_")) return;

  const { data } = await client.auth.getSession();
  const session = data.session;

  if (!session) {
    pendingCheckoutPriceId = priceId;
    setAuthMode("login");
    if (authError) {
      authError.hidden = false;
      authError.textContent =
        "有料プランをお選びいただく前にログイン（または無料アカウント作成）が必要です。";
    }
    authDialog?.showModal();
    const elFocus = authForm?.elements.namedItem("email");
    if (elFocus instanceof HTMLElement && typeof elFocus.focus === "function") {
      elFocus.focus();
    }
    return;
  }

  pendingCheckoutPriceId = null;

  const res = await fetch("/api/create-checkout-session", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ priceId }),
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const msg =
      typeof payload.error === "string" ? payload.error : "決済開始に失敗しました";
    alert(msg);
    return;
  }

  const url =
    typeof payload.url === "string" && payload.url.startsWith("https") ?
      payload.url
      : "";

  if (url) window.location.href = url;
  else alert("決済ページの URL を取得できませんでした");
}

document.body.addEventListener("click", (e) => {
  const btn = /** @type {HTMLElement | null} */ (e.target).closest(
    "[data-checkout][data-price-id]",
  );
  if (!btn) return;
  e.preventDefault();
  startCheckout(btn.getAttribute("data-price-id") || "");
});

const boot = async () => {
  supabase = await loadSupabase();
  if (!supabase || !authDialog) return;

  supabase.auth.onAuthStateChange((_event, sess) => {
    renderAuth(sess);
  });

  const { data } = await supabase.auth.getSession();
  renderAuth(data.session);

  openAuthBtn?.addEventListener("click", () => {
    setAuthMode("login");
    if (authError) {
      authError.textContent = "";
      authError.hidden = true;
    }
    pendingCheckoutPriceId = null;
    authDialog?.showModal();
  });

  signOutBtn?.addEventListener("click", async () => {
    pendingCheckoutPriceId = null;
    await supabase.auth.signOut();
  });

  document.getElementById("auth-dialog-close")?.addEventListener("click", () => {
    pendingCheckoutPriceId = null;
    authDialog?.close();
    if (authError) {
      authError.textContent = "";
      authError.hidden = true;
    }
  });

  authForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const client = supabase;
    if (!client || !authError || !authForm) return;

    authError.textContent = "";

    const emailEl = /** @type {HTMLInputElement | null} */ (
      authForm.elements.namedItem("email")
    );
    const passEl = /** @type {HTMLInputElement | null} */ (
      authForm.elements.namedItem("password")
    );

    const email = emailEl?.value?.trim() || "";
    const password = passEl?.value || "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      authError.textContent = "有効なメールアドレスを入力してください。";
      authError.hidden = false;
      return;
    }

    if (password.length < 6) {
      authError.textContent = "パスワードは6文字以上で設定してください。";
      authError.hidden = false;
      return;
    }

    const queuedPrice = pendingCheckoutPriceId;

    if (authMode === "signup") {
      const { error } = await client.auth.signUp({ email, password });
      if (error) {
        authError.textContent = error.message;
        authError.hidden = false;
        return;
      }

      alert(
        "確認メールを送信した場合など、完了後にもう一度ログインしてください。ログイン済みのアカウントになると続けてチェックアウトできます。"
      );

      pendingCheckoutPriceId = queuedPrice;
      setAuthMode("login");
      return;
    }

    const { error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      authError.textContent = error.message;
      authError.hidden = false;
      return;
    }

    authDialog?.close();
    pendingCheckoutPriceId = null;

    if (queuedPrice) await startCheckout(queuedPrice);
  });
};

boot().catch(console.error);
