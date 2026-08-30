CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  plan ENUM('Free', 'Pro', 'Team') DEFAULT 'Free',
  seats INT DEFAULT 1,
  active TINYINT(1) DEFAULT 1,
  signup_date DATE
);

INSERT INTO customers (name, email, plan, seats, active, signup_date) VALUES
 ('Panorama', 'it@panorama-group.com', 'Team', 58, 1, '2026-01-27'),
 ('Lumen Health', 'admin@lumen.health', 'Pro', 7, 0, '2026-02-14'),
 ('Atelier Vif', 'contact@ateliervif.fr', 'Pro', 2, 1, '2026-03-30'),
 ('Grain Analytics', 'ops@grain.dev', 'Team', 19, 0, '2026-04-16');

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT,
  amount DECIMAL(10,2),
  status VARCHAR(50),
  ordered_at DATE,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

INSERT INTO orders (customer_id, amount, status, ordered_at) VALUES
 (1, 6890.40, 'paid', '2026-01-27'),
 (2, 203.00, 'refunded', '2026-02-14'),
 (3, 58.00, 'paid', '2026-03-30');
