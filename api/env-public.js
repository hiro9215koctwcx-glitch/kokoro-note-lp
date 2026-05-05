export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = process.env.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!url || !anonKey) {
    res.status(503).json({ error: "Supabase が未設定です（SUPABASE_URL / SUPABASE_ANON_KEY）" });
    return;
  }

  res.status(200).json({
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
  });
}
