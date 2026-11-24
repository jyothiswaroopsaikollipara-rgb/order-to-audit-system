export function registerReports(app, db, auth, route) {
  const queries = {

    customer_sales: `
      SELECT
        c.id AS customer_id,
        c.name AS customer,
        COUNT(i.id) AS invoice_count,
        SUM(o.qty) AS quantity,
        SUM(i.taxable) AS taxable_sales,
        SUM(i.cgst) AS cgst,
        SUM(i.sgst) AS sgst,
        SUM(i.igst) AS igst,
        SUM(i.total) AS invoice_total
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      WHERE i.created_at >= $1
        AND i.created_at < $2
      GROUP BY c.id, c.name
      ORDER BY invoice_total DESC, c.name
    `,

    product_sales: `
      SELECT
        p.id AS item_id,
        p.sku AS product,
        p.name,
        p.unit,
        COUNT(i.id) AS invoice_count,
        SUM(o.qty) AS quantity,
        SUM(i.taxable) AS taxable_sales,
        SUM(i.cgst) AS cgst,
        SUM(i.sgst) AS sgst,
        SUM(i.igst) AS igst,
        SUM(i.total) AS invoice_total
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN items p ON p.id = o.item_id
      WHERE i.created_at >= $1
        AND i.created_at < $2
      GROUP BY p.id, p.sku, p.name, p.unit
      ORDER BY invoice_total DESC, p.sku
    `,

    customer_ageing: `
      WITH balances AS (
        SELECT
          i.id,
          c.id AS customer_id,
          c.name AS customer,
          i.total,
          COALESCE(SUM(p.amount), 0) AS paid,
          i.total - COALESCE(SUM(p.amount), 0)
            AS outstanding,
          (
            ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
            - 1
            -
            (i.created_at AT TIME ZONE 'Asia/Kolkata')::date
          ) AS age_days
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN payments p
          ON p.invoice_id = i.id
          AND p.created_at < $2
        WHERE i.created_at < $2
          AND $1::timestamptz < $2::timestamptz
        GROUP BY i.id, c.id, c.name
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
    `,

    sales: `
      SELECT
        i.invoice_no,
        i.created_at AS invoice_date,
        c.name AS customer,
        p.sku AS product,
        o.qty AS quantity,
        i.taxable,
        i.cgst,
        i.sgst,
        i.igst,
        i.total
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      JOIN items p ON p.id = o.item_id
      WHERE i.created_at >= $1
        AND i.created_at < $2
      ORDER BY i.created_at, i.id
    `,

    gst: `
      SELECT
        CASE WHEN c.state_code = '33'
          THEN 'Intrastate'
          ELSE 'Interstate'
        END AS supply_type,
        COUNT(*) AS invoices,
        SUM(i.taxable) AS taxable,
        SUM(i.cgst) AS cgst,
        SUM(i.sgst) AS sgst,
        SUM(i.igst) AS igst,
        SUM(i.cgst+i.sgst+i.igst) AS total_tax,
        SUM(i.total) AS invoice_total
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      WHERE i.created_at >= $1
        AND i.created_at < $2
      GROUP BY 1
      ORDER BY 1
    `,

    purchases: `
      SELECT
        p.id AS purchase_id,
        p.reference,
        p.created_at,
        i.sku AS material,
        i.unit,
        p.qty AS quantity,
        p.unit_cost,
        ROUND(p.qty*p.unit_cost, 2) AS purchase_value
      FROM purchases p
      JOIN items i ON i.id = p.item_id
      WHERE p.created_at >= $1
        AND p.created_at < $2
      ORDER BY p.created_at, p.id
    `,

    stock: `
      SELECT
        i.sku,
        i.name,
        i.unit,
        COALESCE(SUM(m.delta) FILTER (
          WHERE m.created_at < $1
        ), 0) AS opening_stock,
        COALESCE(SUM(m.delta) FILTER (
          WHERE m.created_at >= $1
            AND m.delta > 0
        ), 0) AS receipts,
        COALESCE(SUM(-m.delta) FILTER (
          WHERE m.created_at >= $1
            AND m.delta < 0
        ), 0) AS issues,
        COALESCE(SUM(m.delta), 0) AS closing_stock
      FROM items i
      LEFT JOIN stock_movements m
        ON m.item_id = i.id
        AND m.created_at < $2
      GROUP BY i.id
      ORDER BY i.id
    `,

    ledger: `
      SELECT
        m.id AS movement_id,
        m.created_at,
        i.sku,
        i.unit,
        m.delta AS quantity_change,
        m.source_type,
        m.source_id,
        m.line_key,
        m.unit_cost
      FROM stock_movements m
      JOIN items i ON i.id = m.item_id
      WHERE m.created_at >= $1
        AND m.created_at < $2
      ORDER BY m.created_at, m.id
    `,

    production: `
      SELECT
        r.id AS run_id,
        r.created_at,
        i.sku AS product,
        r.expected_output,
        r.good_output,
        ROUND(
          (r.good_output/r.expected_output-1)*100,
          2
        ) AS yield_variance_pct,
        r.material_cost,
        r.overhead,
        r.material_cost+r.overhead AS total_cost,
        r.cost_per_packet
      FROM production_runs r
      JOIN bom b ON b.id = r.bom_id
      JOIN items i ON i.id = b.finished_item_id
      WHERE r.created_at >= $1
        AND r.created_at < $2
      ORDER BY r.id
    `,

    materials: `
      SELECT
        r.id AS run_id,
        r.created_at,
        i.sku AS material,
        i.unit,
        p.planned_qty,
        p.qty AS actual_issued,
        p.damaged_qty,
        p.variance_pct
      FROM production_issues p
      JOIN production_runs r ON r.id = p.run_id
      JOIN items i ON i.id = p.item_id
      WHERE r.created_at >= $1
        AND r.created_at < $2
      ORDER BY r.id, p.item_id
    `,

    collections: `
      SELECT
        p.id AS payment_id,
        p.created_at,
        p.reference,
        i.invoice_no,
        c.name AS customer,
        p.amount
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      WHERE p.created_at >= $1
        AND p.created_at < $2
      ORDER BY p.created_at, p.id
    `,

    receivables: `
      WITH balances AS (
        SELECT
          i.id,
          i.invoice_no,
          i.created_at AS invoice_date,
          c.name AS customer,
          i.total,
          COALESCE(SUM(p.amount),0) AS paid,
          i.total-COALESCE(SUM(p.amount),0)
            AS outstanding,
          (($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
            - 1
            - (i.created_at AT TIME ZONE 'Asia/Kolkata')::date
          ) AS age_days
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN payments p
          ON p.invoice_id = i.id
          AND p.created_at < $2
        WHERE i.created_at < $2
          AND $1::timestamptz < $2::timestamptz
        GROUP BY i.id,c.name
      )
      SELECT *,
        CASE
          WHEN age_days <= 30 THEN '0-30 days'
          WHEN age_days <= 60 THEN '31-60 days'
          WHEN age_days <= 90 THEN '61-90 days'
          ELSE '90+ days'
        END AS ageing_bucket
      FROM balances
      WHERE outstanding > 0
      ORDER BY customer, invoice_date
    `,

    audit: `
      SELECT
        a.id AS event_id,
        a.created_at,
        u.email AS actor,
        u.role,
        a.entity_type,
        a.entity_id,
        a.action,
        a.details
      FROM audit_events a
      LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.created_at >= $1
        AND a.created_at < $2
      ORDER BY a.created_at, a.id
    `
  };

  function validDate(value) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) return false;

    const date = new Date(`${value}T00:00:00Z`);

    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0,10) === value;
  }

  function csvCell(value) {
    let text = value == null
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);

    // Prevent spreadsheet formula injection.
    if (
      /^[\s]*[=+\-@]/.test(text) &&
      !/^-?\d+(\.\d+)?$/.test(text)
    ) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  app.get(
    '/reports/monthly/:type',
    auth('ADMIN', 'AUDITOR', 'OWNER'),
    route(async (req, res) => {
      const { type } = req.params;
      const { from, to, format = 'json' } = req.query;

      if (!Object.hasOwn(queries, type)) {
        return res.status(404).json({
          error: 'Unknown report type'
        });
      }

      if (!validDate(from) || !validDate(to) || from > to) {
        return res.status(400).json({
          error: 'Provide a valid from and to date'
        });
      }

      if (!['json', 'csv'].includes(format)) {
        return res.status(400).json({
          error: 'Unsupported report format'
        });
      }

      // Indian business-day boundaries.
      const start = new Date(`${from}T00:00:00+05:30`);
      const end = new Date(`${to}T00:00:00+05:30`);

      end.setTime(end.getTime() + 86400000);

      const result = await db.query(
        queries[type],
        [start.toISOString(), end.toISOString()]
      );

      const columns = result.fields.map(field => field.name);
      const rows = result.rows;

      if (format === 'csv') {
        const csv = [
          columns.map(csvCell).join(','),
          ...rows.map(row =>
            columns.map(column => csvCell(row[column])).join(',')
          )
        ].join('\r\n');

        res.setHeader(
          'Content-Type',
          'text/csv; charset=utf-8'
        );

        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${type}-${from}-${to}.csv"`
        );

        return res.send('\uFEFF' + csv);
      }

      res.json({
        report: type,
        from,
        to,
        timezone: 'Asia/Kolkata',
        columns,
        rows
      });
    })
  );
}