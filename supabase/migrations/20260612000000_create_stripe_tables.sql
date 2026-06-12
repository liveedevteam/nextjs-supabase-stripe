create table stripe_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  stripe_customer_id text unique not null,
  created_at timestamptz default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  stripe_subscription_id text unique not null,
  stripe_price_id text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  stripe_session_id text unique not null,
  amount integer not null,
  currency text not null,
  status text not null,
  created_at timestamptz default now()
);

create table products (
  id text primary key,
  name text not null,
  description text,
  active boolean default true
);

create table prices (
  id text primary key,
  product_id text references products(id) not null,
  unit_amount integer,
  currency text not null,
  interval text,
  active boolean default true
);

create table webhook_events (
  id text primary key,
  type text not null,
  processed_at timestamptz default now()
);
