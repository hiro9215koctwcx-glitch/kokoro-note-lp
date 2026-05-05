-- Supabase で実行してください（Dashboard → SQL Editor）
-- public.users が既にある前提です（id / email / plan / trial_start_date はそのまま利用）。
-- Stripe 連携用の列のみ追加します。plan は新規作成しません。
--
-- RLS ポリシーについて:
-- - このファイルではポリシーを作成・削除しません（既に定義済みの場合の重複実行エラーを避けるため）。
-- - Checkout / Webhook は service_role キーを使うため、RLS はバイパスされ、stripe_* と plan を更新できます。

alter table public.users
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;
