const Database = require("better-sqlite3");
const path = require("node:path");

const file = path.join(__dirname, "sample.sqlite");
const db = new Database(file);

db.exec(`
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS customers;

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    plan TEXT,
    seats INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT 1,
    signup_date TEXT
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id),
    amount REAL,
    status TEXT,
    ordered_at TEXT
  );
`);

const insertCustomer = db.prepare(
  "INSERT INTO customers (name, email, plan, seats, active, signup_date) VALUES (?, ?, ?, ?, ?, ?)"
);
[
  ["Rue Verte", "compta@rueverte.fr", "Free", 1, 0, "2026-01-06"],
  ["Hélios", "tech@helios.energy", "Team", 26, 1, "2026-02-24"],
  ["Tomas Bergé", "tomas@berge.me", "Free", 1, 1, "2026-03-02"],
].forEach((row) => insertCustomer.run(...row));

const insertOrder = db.prepare(
  "INSERT INTO orders (customer_id, amount, status, ordered_at) VALUES (?, ?, ?, ?)"
);
[
  [1, 0, "pending", "2026-01-06"],
  [2, 68904, "paid", "2026-02-24"],
  [3, 0, "pending", "2026-03-02"],
].forEach((row) => insertOrder.run(...row));

console.log("Seeded", file);
