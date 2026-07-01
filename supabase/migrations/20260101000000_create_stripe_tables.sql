create table stripe_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique not null,
  created_at timestamptz default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  stripe_subscription_id text unique not null,
  stripe_price_id text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  cancel_at timestamptz,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  stripe_session_id text unique not null,
  amount integer not null,
  currency text not null,
  status text not null,
  created_at timestamptz default now()
);

create table webhook_events (
  id text primary key,
  type text not null,
  created_at timestamptz default now()
);

-- RLS
alter table stripe_customers enable row level security;
alter table subscriptions enable row level security;
alter table orders enable row level security;
alter table webhook_events enable row level security;

create policy "users_read_own_stripe_customer" on stripe_customers
  for select to authenticated using (auth.uid() = user_id);

create policy "users_read_own_subscriptions" on subscriptions
  for select to authenticated using (auth.uid() = user_id);

create policy "users_read_own_orders" on orders
  for select to authenticated using (auth.uid() = user_id);

grant all on stripe_customers, subscriptions, orders, webhook_events to service_role;
grant all on stripe_customers, subscriptions, orders, webhook_events to anon;
grant all on stripe_customers, subscriptions, orders, webhook_events to authenticated;
