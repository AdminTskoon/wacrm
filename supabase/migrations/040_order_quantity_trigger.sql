-- ============================================================
-- 043_order_quantity_trigger.sql
-- ============================================================
-- Final stock rule:
--  - debit stock on insert into order_items
--  - restore stock on delete from order_items
--  - keep a single consistent trigger pair, without stale old triggers
-- ============================================================

-- ============================================================
-- Ensure tables produits, orders, and order_items exist
-- ============================================================
CREATE TABLE IF NOT EXISTS public.produits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT,
  title TEXT,
  description TEXT,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  availability TEXT DEFAULT 'in stock',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_name TEXT,
  contact_phone TEXT,
  payment_status TEXT DEFAULT 'pending',
  status TEXT DEFAULT 'confirmed',
  total NUMERIC(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  produit_id UUID REFERENCES public.produits(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  item_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS produits_all ON public.produits;
CREATE POLICY produits_all ON public.produits FOR ALL USING (is_account_member(account_id));

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_all ON public.orders;
CREATE POLICY orders_all ON public.orders FOR ALL USING (is_account_member(account_id));

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_all ON public.order_items;
CREATE POLICY order_items_all ON public.order_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_items.order_id AND is_account_member(orders.account_id))
);

DROP TRIGGER IF EXISTS trg_decrease_product_quantity ON order_items;
DROP TRIGGER IF EXISTS trg_apply_order_item_stock ON order_items;
DROP TRIGGER IF EXISTS trg_restore_order_item_stock ON order_items;
DROP TRIGGER IF EXISTS trg_order_item_debit_stock ON order_items;
DROP TRIGGER IF EXISTS trg_order_item_restore_stock ON order_items;

DROP FUNCTION IF EXISTS decrease_product_quantity();
DROP FUNCTION IF EXISTS enforce_order_item_stock();
DROP FUNCTION IF EXISTS apply_order_item_stock_change();
DROP FUNCTION IF EXISTS restore_order_item_stock_change();

CREATE OR REPLACE FUNCTION order_item_debit_stock()
RETURNS TRIGGER AS $$
DECLARE
  v_requested INTEGER;
  v_current INTEGER;
BEGIN
  IF NEW.produit_id IS NULL THEN
    RAISE EXCEPTION 'Le produit est requis pour créer une commande';
  END IF;

  v_requested := COALESCE(NEW.quantity, 0);

  IF v_requested <= 0 THEN
    RAISE EXCEPTION 'La quantité commandée doit être supérieure à 0';
  END IF;

  SELECT quantity INTO v_current
  FROM produits
  WHERE id = NEW.produit_id;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Produit introuvable';
  END IF;

  IF v_current < v_requested THEN
    RAISE EXCEPTION 'Stock insuffisant : % restant(s)', v_current;
  END IF;

  UPDATE produits
  SET
    quantity = quantity - v_requested,
    availability = CASE
      WHEN (quantity - v_requested) <= 0 THEN 'out of stock'
      ELSE 'in stock'
    END
  WHERE id = NEW.produit_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION order_item_restore_stock()
RETURNS TRIGGER AS $$
DECLARE
  v_qty INTEGER;
BEGIN
  IF OLD.produit_id IS NULL THEN
    RETURN OLD;
  END IF;

  v_qty := COALESCE(OLD.quantity, 0);

  IF v_qty <= 0 THEN
    RETURN OLD;
  END IF;

  UPDATE produits
  SET
    quantity = quantity + v_qty,
    availability = CASE
      WHEN (quantity + v_qty) > 0 THEN 'in stock'
      ELSE 'out of stock'
    END
  WHERE id = OLD.produit_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_order_item_debit_stock
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION order_item_debit_stock();

CREATE TRIGGER trg_order_item_restore_stock
AFTER DELETE ON order_items
FOR EACH ROW
EXECUTE FUNCTION order_item_restore_stock();
