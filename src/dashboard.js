
export function registerDashboard(app, db, auth, route) {
  app.get(
    '/dashboard/summary',
    auth('ADMIN', 'OWNER', 'SALESMAN'),
    route(async (req, res) => {
      const salesmanOnly = req.user.role === 'SALESMAN';
      const salesmanId = salesmanOnly ? req.user.id : null;

      const salesParams = [salesmanId];

      const orders = await db.query(`
        SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (
            WHERE status = 'SUBMITTED'
          )::int AS submitted,
          COUNT(*) FILTER (
            WHERE status = 'APPROVED'
          )::int AS approved,
          COUNT(*) FILTER (
            WHERE status = 'INVOICED'
          )::int AS invoiced,
          COUNT(*) FILTER (
            WHERE status = 'DISPATCHED'
          )::int AS dispatched,
          COUNT(*) FILTER (
            WHERE status = 'REJECTED'
          )::int AS rejected,
          COUNT(*) FILTER (
            WHERE
              (created_at AT TIME ZONE 'Asia/Kolkata')::date
              =
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          )::int AS today_orders
        FROM orders
        WHERE (
          $1::bigint IS NULL
          OR salesman_id = $1
        )
      `, salesParams);

      const sales = await db.query(`
        SELECT
          COUNT(i.id)::int AS invoice_count,
          COALESCE(SUM(i.taxable), 0) AS taxable_sales,
          COALESCE(SUM(i.total), 0) AS invoiced_sales,
          COALESCE(SUM(i.total) FILTER (
            WHERE
              (i.created_at AT TIME ZONE 'Asia/Kolkata')::date
              =
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
          ), 0) AS today_sales
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        WHERE (
          $1::bigint IS NULL
          OR o.salesman_id = $1
        )
      `, salesParams);

      const customerSales = await db.query(`
        SELECT
          c.id AS customer_id,
          c.name AS customer,
          COUNT(i.id)::int AS invoices,
          SUM(o.qty) AS quantity,
          SUM(i.taxable) AS taxable_sales,
          SUM(i.total) AS invoice_total
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        WHERE (
          $1::bigint IS NULL
          OR o.salesman_id = $1
        )
        GROUP BY c.id, c.name
        ORDER BY invoice_total DESC, c.name
      `, salesParams);

      const productSales = await db.query(`
        SELECT
          p.id AS item_id,
          p.sku AS product,
          p.unit,
          COUNT(i.id)::int AS invoices,
          SUM(o.qty) AS quantity,
          SUM(i.taxable) AS taxable_sales,
          SUM(i.total) AS invoice_total
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN items p ON p.id = o.item_id
        WHERE (
          $1::bigint IS NULL
          OR o.salesman_id = $1
        )
        GROUP BY p.id, p.sku, p.unit
        ORDER BY invoice_total DESC, p.sku
      `, salesParams);

      const base = {
        scope: salesmanOnly ? 'OWN' : 'BUSINESS',
        timezone: 'Asia/Kolkata',
        generated_at: new Date().toISOString(),
        orders: orders.rows[0],
        sales: sales.rows[0],
        customer_sales: customerSales.rows,
        product_sales: productSales.rows
      };

      // Salesmen receive only their own order and sales data.
      if (salesmanOnly) {
        return res.json(base);
      }

      const stock = await db.query(`
        SELECT
          i.id AS item_id,
          i.sku,
          i.name,
          i.kind,
          i.unit,
          COALESCE(s.quantity, 0) AS quantity
        FROM items i
        LEFT JOIN stock_balances s
          ON s.item_id = i.id
        ORDER BY i.kind, i.id
      `);

      const production = await db.query(`
        WITH runs AS (
          SELECT
            r.*,
            i.sku AS product,
            COALESCE(
              r.selling_price_snapshot,
              i.selling_price
            ) AS selling_price,
            COALESCE(
              r.variance_tolerance_pct,
              ps.variance_tolerance_pct
            ) AS tolerance,
            ROUND(
              (r.good_output / NULLIF(r.expected_output, 0) - 1)
              * 100,
              2
            ) AS yield_variance_pct
          FROM production_runs r
          JOIN bom b ON b.id = r.bom_id
          JOIN items i ON i.id = b.finished_item_id
          CROSS JOIN production_settings ps
          WHERE ps.id = 1
        )
        SELECT
          r.id,
          r.created_at,
          r.product,
          r.expected_output,
          r.good_output,
          ROUND(
            r.good_output / NULLIF(r.expected_output, 0) * 100,
            2
          ) AS yield_pct,
          r.yield_variance_pct,
          r.tolerance,
          r.material_cost,
          r.overhead,
          r.material_cost + r.overhead AS total_cost,
          r.cost_per_packet,
          r.selling_price,
          ROUND(
            r.selling_price -
            (r.material_cost + r.overhead)
              / NULLIF(r.good_output, 0),
            2
          ) AS profit_per_packet,
          ROUND(
            (
              r.selling_price -
              (r.material_cost + r.overhead)
                / NULLIF(r.good_output, 0)
            ) / NULLIF(r.selling_price, 0) * 100,
            2
          ) AS margin_pct,
          (r.selling_price_snapshot IS NULL)
            AS historical_price,
          (r.variance_tolerance_pct IS NULL)
            AS historical_tolerance,
          (
            CASE
              WHEN ABS(r.yield_variance_pct) > r.tolerance
              THEN 1 ELSE 0
            END
            +
            (
              SELECT COUNT(*)::int
              FROM production_issues pi
              WHERE pi.run_id = r.id
                AND ABS(pi.variance_pct) > r.tolerance
            )
          ) AS alert_count
        FROM runs r
        ORDER BY r.created_at DESC, r.id DESC
      `);

      const receivables = await db.query(`
        WITH payment_totals AS (
          SELECT
            invoice_id,
            SUM(amount) AS paid
          FROM payments
          GROUP BY invoice_id
        ),
        balances AS (
          SELECT
            c.id AS customer_id,
            c.name AS customer,
            i.total,
            COALESCE(p.paid, 0) AS paid,
            i.total - COALESCE(p.paid, 0)
              AS outstanding,
            (
              (NOW() AT TIME ZONE 'Asia/Kolkata')::date
              -
              (i.created_at AT TIME ZONE 'Asia/Kolkata')::date
            ) AS age_days
          FROM invoices i
          JOIN orders o ON o.id = i.order_id
          JOIN customers c ON c.id = o.customer_id
          LEFT JOIN payment_totals p
            ON p.invoice_id = i.id
        )
        SELECT
          customer_id,
          customer,
          SUM(total) AS invoiced,
          SUM(paid) AS collected,
          SUM(outstanding) AS outstanding,
          COALESCE(SUM(outstanding) FILTER (
            WHERE age_days <= 30
              AND outstanding > 0
          ), 0) AS ageing_0_30,
          COALESCE(SUM(outstanding) FILTER (
            WHERE age_days BETWEEN 31 AND 60
              AND outstanding > 0
          ), 0) AS ageing_31_60,
          COALESCE(SUM(outstanding) FILTER (
            WHERE age_days BETWEEN 61 AND 90
              AND outstanding > 0
          ), 0) AS ageing_61_90,
          COALESCE(SUM(outstanding) FILTER (
            WHERE age_days > 90
              AND outstanding > 0
          ), 0) AS ageing_over_90
        FROM balances
        GROUP BY customer_id, customer
        ORDER BY outstanding DESC, customer
      `);

      res.json({
        ...base,
        stock: stock.rows,
        production: production.rows,
        latest_production: production.rows[0] ?? null,
        production_alerts: production.rows.reduce(
          (sum, row) => sum + Number(row.alert_count),
          0
        ),
        receivables: receivables.rows
      });
    })
  );
}
