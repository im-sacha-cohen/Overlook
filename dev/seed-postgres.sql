CREATE TABLE customers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text,
  plan text,
  seats integer DEFAULT 1,
  active boolean DEFAULT true,
  signup_date date
);

INSERT INTO customers (name, email, plan, seats, active, signup_date) VALUES
 ('Fabrik Studio', 'ops@fabrik.io', 'Team', 12, true, '2026-01-04'),
 ('Camille Roy', 'camille@roy.dev', 'Pro', 1, true, '2026-02-11'),
 ('Northbeam', 'billing@northbeam.co', 'Team', 34, true, '2026-03-18'),
 ('Studio Mira', 'hello@studiomira.fr', 'Pro', 4, false, '2026-04-09'),
 ('Kilo Labs', 'dev@kilolabs.io', 'Pro', 3, false, '2026-05-22');

CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer_id integer REFERENCES customers(id),
  amount numeric,
  status text,
  ordered_at date
);

INSERT INTO orders (customer_id, amount, status, ordered_at) VALUES
 (1, 1200.50, 'paid', '2026-01-10'),
 (2, 29.00, 'paid', '2026-02-12'),
 (3, 4000, 'pending', '2026-03-20'),
 (4, 87.00, 'refunded', '2026-04-15');
