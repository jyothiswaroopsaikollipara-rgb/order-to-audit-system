import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {D,money,variance,tax,convertQuantity,varianceAlert,productionMargin} from './math.js';
import { registerReports } from './reports.js';
import {
  registerInvoicePdf,
  financialYearPrefix,
  billingSnapshot
} from './invoicePdf.js';
import { registerDashboard } from './dashboard.js';

if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32 || !process.env.DATABASE_URL) throw Error('DATABASE_URL and JWT_SECRET (32+ characters) required');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
const id=z.coerce.number().int().positive();const qty=z.union([z.string(),z.number()]).transform(x=>String(x)).pipe(z.string().regex(/^\d{1,10}(\.\d{1,4})?$/)).refine(x=>D(x).gt(0));
const uuid=z.string().uuid();const text=z.string().min(1).max(100);
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function tx(fn){const c=await db.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM inventory_mutex WHERE id=1 FOR UPDATE');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const query=(c,s,p=[])=>c.query(s,p);
async function balance(c,item){const r=await query(c,'SELECT COALESCE(SUM(delta),0)::text n FROM stock_movements WHERE item_id=$1',[item]);return D(r.rows[0].n);}
async function debit(c,item,amount,type,source,key,actor){if((await balance(c,item)).lt(amount)) throw fail(409,`Insufficient stock for item ${item}`);await query(c,'INSERT INTO stock_movements(item_id,delta,source_type,source_id,line_key) VALUES($1,$2,$3,$4,$5)',[item,D(amount).neg().toFixed(),type,source,key]);}
async function audit(c,user,type,id,action,details={}){await query(c,'INSERT INTO audit_events(actor_id,entity_type,entity_id,action,details) VALUES($1,$2,$3,$4,$5)',[user,type,id,action,JSON.stringify(details)]);}
const route = (handler) => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);
const auth=(...roles)=>route(async(req,res,next)=>{const token=(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1];if(!token)throw fail(401,'Authentication required');let data;try{data=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});}catch{throw fail(401,'Invalid or expired token');}const r=await db.query('SELECT id,role FROM users WHERE id=$1',[data.sub]);if(!r.rowCount)throw fail(401,'Unknown user');req.user=r.rows[0];if(roles.length&&!roles.includes(req.user.role))throw fail(403,'Role not permitted');next();});
app.get('/health',route(async(req,res)=>{await db.query('SELECT 1');res.json({status:'ok'});}));

app.post('/auth/login', route(async (req, res) => {
  const { email, password } = z.object({
    email: z.string().email(),
    password: z.string()
  }).parse(req.body);

  const r = await db.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  if (
    !r.rowCount ||
    !await bcrypt.compare(password, r.rows[0].password_hash)
  ) {
    throw fail(401, 'Invalid credentials');
  }

  const u = r.rows[0];

  res.json({
    token: jwt.sign(
      {
        sub: String(u.id),
        role: u.role
      },
      process.env.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: '4h'
      }
    ),
    role: u.role,
    userId: String(u.id)
  });
}));

app.get('/stock',auth('ADMIN','PRODUCTION','AUDITOR','OWNER'),route(async(req,res)=>res.json((await db.query('SELECT * FROM stock_balances ORDER BY item_id')).rows)));
app.get('/stock/ledger',auth('ADMIN','PRODUCTION','AUDITOR','OWNER'),route(async(req,res)=>res.json((await db.query('SELECT m.*,i.sku FROM stock_movements m JOIN items i ON i.id=m.item_id ORDER BY m.id')).rows)));

app.get(
  '/masters',
  auth('ADMIN', 'PRODUCTION', 'SALESMAN', 'OWNER'),
  route(async (req, res) => {

    if (req.user.role === 'SALESMAN') {
      const [items, customers] = await Promise.all([
        db.query(`
          SELECT
            id,
            sku,
            name,
            kind,
            unit,
            selling_price,
            gst_rate,
            units_per_carton
          FROM items
          WHERE kind = 'FINISHED'
          ORDER BY name
        `),

        db.query(`
          SELECT id, name, state_code
          FROM customers
          ORDER BY name
        `)
      ]);

      return res.json({
        items: items.rows,
        customers: customers.rows,
        boms: []
      });
    }

    const [items, customers, boms] = await Promise.all([
      db.query('SELECT * FROM items ORDER BY id'),
      db.query('SELECT * FROM customers ORDER BY id'),
      db.query('SELECT * FROM bom')
    ]);

    res.json({
      items: items.rows,
      customers: customers.rows,
      boms: boms.rows
    });
  })
);

app.post(
  '/masters/items/:id/carton-ratio',
  auth('ADMIN'),
  route(async (req, res) => {
    const data = z.object({
      unitsPerCarton: z.number()
        .int()
        .positive()
        .max(1000000)
        .nullable()
    }).parse(req.body);

    const result = await tx(async c => {
      await query(
        c,
        'SELECT id FROM inventory_mutex WHERE id = 1 FOR UPDATE'
      );

      const existing = await query(
        c,
        `SELECT id, sku, unit, units_per_carton
         FROM items
         WHERE id = $1
         FOR UPDATE`,
        [req.params.id]
      );

      if (!existing.rowCount) {
        throw fail(404, 'Item not found');
      }

      const item = existing.rows[0];

      if (!['piece', 'packet'].includes(item.unit)) {
        throw fail(
          400,
          'Carton ratio requires a piece or packet based item'
        );
      }

      const updated = await query(
        c,
        `UPDATE items
         SET units_per_carton = $1
         WHERE id = $2
         RETURNING id, sku, unit, units_per_carton`,
        [
          data.unitsPerCarton,
          item.id
        ]
      );

      await audit(
        c,
        req.user.id,
        'ITEM',
        item.id,
        'CARTON_RATIO_UPDATED',
        {
          before: item.units_per_carton,
          after: updated.rows[0].units_per_carton
        }
      );

      return updated.rows[0];
    });

    res.json(result);
  })
);

app.get(
  '/production/boms',
  auth('ADMIN', 'PRODUCTION'),
  route(async (req, res) => {

    const result = await db.query(`
      SELECT
        b.id,
        b.expected_output,
        finished.sku AS finished_product,
        l.item_id,
        l.planned_qty,
        material.sku AS material_sku,
        material.unit,
        material.units_per_carton
      FROM bom b
      JOIN items finished
        ON finished.id = b.finished_item_id
      JOIN bom_lines l
        ON l.bom_id = b.id
      JOIN items material
        ON material.id = l.item_id
      ORDER BY b.id, l.item_id
    `);

    const grouped = new Map();

    for (const row of result.rows) {
      if (!grouped.has(row.id)) {
        grouped.set(row.id, {
          id: row.id,
          expected_output: row.expected_output,
          finished_product: row.finished_product,
          lines: []
        });
      }

      grouped.get(row.id).lines.push({
        item_id: Number(row.item_id),
        planned_qty: row.planned_qty,
        sku: row.material_sku,
        unit: row.unit,
        units_per_carton: row.units_per_carton
      });
    }

    res.json([...grouped.values()]);
  })
);


app.get(
  '/orders',
  auth('ADMIN', 'SALESMAN', 'OWNER'),
  route(async (req, res) => {

    const salesman = req.user.role === 'SALESMAN';

    const result = await db.query(
      `SELECT
         o.id,
         o.customer_id,
         c.name AS customer_name,
         o.salesman_id,
         o.item_id,
         i.sku,
         o.qty,
         o.status,
         o.rejection_reason,
         o.created_at,
         o.updated_at,
         COALESCE(
           o.unit_price,
           i.selling_price
         ) AS unit_price,
         (
           o.qty * COALESCE(
             o.unit_price,
             i.selling_price
           )
         )::numeric(18,2) AS order_value
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN items i ON i.id = o.item_id
       ${salesman ? 'WHERE o.salesman_id = $1' : ''}
       ORDER BY o.id DESC`,
      salesman ? [req.user.id] : []
    );

    res.json(result.rows);
  })
);

app.get('/invoices',
  auth('ADMIN', 'OWNER', 'AUDITOR'),
  route(async (req, res) => {
    const result = await db.query(`
      SELECT
        i.id,
        i.invoice_no,
        i.order_id,
        c.name AS customer_name,
        i.taxable,
        i.cgst,
        i.sgst,
        i.igst,
        i.total,
        COALESCE(SUM(p.amount), 0)::numeric(18,2) AS paid,
        (i.total - COALESCE(SUM(p.amount), 0))
          ::numeric(18,2) AS outstanding,
        o.status AS order_status,
        EXISTS (
          SELECT 1 FROM dispatches d
          WHERE d.invoice_id = i.id
        ) AS dispatched
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN payments p ON p.invoice_id = i.id
      GROUP BY i.id, c.name, o.status
      ORDER BY i.id DESC
    `);

    res.json(result.rows);
  })
);


app.post(
  '/purchases',
  auth('ADMIN', 'PRODUCTION'),
  route(async (req, res) => {
    const data = z.object({
      reference: text,
      itemId: id,
      quantity: qty,
      unitCost: qty,
      unit: z.string().trim().min(1).optional()
    }).parse(req.body);

    const result = await tx(async c => {
      await query(
        c,
        'SELECT id FROM inventory_mutex WHERE id = 1 FOR UPDATE'
      );

      const itemResult = await query(
        c,
        `SELECT id, sku, kind, unit, units_per_carton
         FROM items
         WHERE id = $1`,
        [data.itemId]
      );

      if (
        !itemResult.rowCount ||
        itemResult.rows[0].kind === 'FINISHED'
      ) {
        throw fail(
          400,
          'Purchase requires raw or packaging item'
        );
      }

      const item = itemResult.rows[0];
      const inputUnit = data.unit ?? item.unit;

      let baseQuantity;
      let baseUnitCost;
      let purchaseValue;

      try {
        const inputQuantity = D(data.quantity);
        const inputCost = D(data.unitCost);

        baseQuantity = convertQuantity(
          inputQuantity,
          inputUnit,
          item.unit,
          item.units_per_carton
        );

        if (
          !baseQuantity.gt(0) ||
          !inputCost.isFinite() ||
          !inputCost.gt(0)
        ) {
          throw new Error('Quantity and cost must be positive');
        }

        purchaseValue = inputQuantity.mul(inputCost);
        baseUnitCost = purchaseValue.div(baseQuantity);

      } catch (error) {
        throw fail(400, error.message);
      }

      if (baseQuantity.decimalPlaces() > 4) {
        throw fail(
          400,
          'Converted quantity exceeds four decimal places'
        );
      }

      if (
        ['piece', 'packet', 'carton'].includes(item.unit) &&
        !baseQuantity.isInteger()
      ) {
        throw fail(400, 'Item requires whole units');
      }

      if (baseUnitCost.decimalPlaces() > 6) {
        throw fail(
          400,
          'Converted unit cost exceeds six decimal places'
        );
      }

      const old = await query(
        c,
        'SELECT * FROM purchases WHERE reference = $1',
        [data.reference]
      );

      if (old.rowCount) {
        const previous = old.rows[0];

        if (
          String(previous.item_id) !== String(data.itemId) ||
          !D(previous.qty).eq(baseQuantity) ||
          !D(previous.unit_cost).eq(baseUnitCost)
        ) {
          throw fail(
            409,
            'Purchase reference already used with different details'
          );
        }

        return {
          id: previous.id,
          replayed: true
        };
      }

      const r = await query(
        c,
        `INSERT INTO purchases (
           reference, item_id, qty, unit_cost
         )
         VALUES ($1,$2,$3,$4)
         RETURNING id`,
        [
          data.reference,
          data.itemId,
          baseQuantity.toFixed(),
          baseUnitCost.toFixed()
        ]
      );

      const purchaseId = r.rows[0].id;

      await query(
        c,
        `INSERT INTO stock_movements (
           item_id, delta, source_type,
           source_id, line_key, unit_cost
         )
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          data.itemId,
          baseQuantity.toFixed(),
          'PURCHASE',
          purchaseId,
          'item',
          baseUnitCost.toFixed()
        ]
      );

      await audit(
        c,
        req.user.id,
        'PURCHASE',
        purchaseId,
        'POSTED',
        {
          inputQuantity: String(data.quantity),
          inputUnit,
          inputUnitCost: String(data.unitCost),
          baseQuantity: baseQuantity.toFixed(),
          baseUnit: item.unit,
          baseUnitCost: baseUnitCost.toFixed(),
          purchaseValue: purchaseValue.toFixed()
        }
      );

      return {
        id: purchaseId,
        replayed: false,
        baseQuantity: baseQuantity.toFixed(),
        baseUnit: item.unit,
        baseUnitCost: baseUnitCost.toFixed(),
        purchaseValue: purchaseValue.toFixed()
      };
    });

    res.status(
      result.replayed ? 200 : 201
    ).json(result);
  })
);

app.get(
  '/production/settings',
  auth('ADMIN', 'PRODUCTION', 'AUDITOR', 'OWNER'),
  route(async (req, res) => {
    const result = await db.query(
      `SELECT variance_tolerance_pct
       FROM production_settings
       WHERE id = 1`
    );

    res.json(result.rows[0]);
  })
);

app.post(
  '/production/settings',
  auth('ADMIN'),
  route(async (req, res) => {
    const data = z.object({
      tolerancePct: z.coerce.number()
        .min(0)
        .max(100)
        .refine(
          n => D(n).decimalPlaces() <= 2,
          'Maximum two decimal places'
        )
    }).parse(req.body);

    const result = await tx(async c => {
      const previous = await query(
        c,
        `SELECT variance_tolerance_pct
         FROM production_settings
         WHERE id = 1
         FOR UPDATE`
      );

      const updated = await query(
        c,
        `UPDATE production_settings
         SET variance_tolerance_pct = $1
         WHERE id = 1
         RETURNING variance_tolerance_pct`,
        [data.tolerancePct]
      );

      await audit(
        c,
        req.user.id,
        'PRODUCTION_SETTINGS',
        1,
        'UPDATED',
        {
          before: previous.rows[0],
          after: updated.rows[0]
        }
      );

      return updated.rows[0];
    });

    res.json(result);
  })
);


app.post(
  '/production-runs',
  auth('PRODUCTION', 'ADMIN'),
  route(async (req, res) => {

    const numeric = z.union([
      z.string().trim().min(1),
      z.number()
    ]);

    const data = z.object({
      requestKey: uuid,
      bomId: id,
      goodOutput: qty,
      issues: z.array(z.object({
        itemId: id,
        quantity: qty,
        damagedQty: numeric.optional(),
        unit: z.string().trim().min(1).optional()
      })).min(1),
      labour: numeric,
      energy: numeric
    }).parse(req.body);

    function nonnegative(value, label) {
      let amount;

      try {
        amount = D(value);
      } catch {
        throw fail(400, `Invalid ${label}`);
      }

      if (!amount.isFinite() || amount.lt(0)) {
        throw fail(400, `Invalid ${label}`);
      }

      return amount;
    }

    const labour = nonnegative(data.labour, 'labour');
    const energy = nonnegative(data.energy, 'energy');

    if (
      labour.decimalPlaces() > 2 ||
      energy.decimalPlaces() > 2
    ) {
      throw fail(400, 'Overhead requires two decimal places or fewer');
    }

    const result = await tx(async c => {

      await query(
        c,
        'SELECT id FROM inventory_mutex WHERE id = 1 FOR UPDATE'
      );

      const old = await query(
        c,
        'SELECT * FROM production_runs WHERE request_key = $1',
        [data.requestKey]
      );

      if (old.rowCount) {
        return {
          run: old.rows[0],
          yieldVariancePct: variance(
            old.rows[0].good_output,
            old.rows[0].expected_output
          ),
          replayed: true
        };
      }

      const bomResult = await query(
        c,
        `SELECT b.*, i.selling_price
         FROM bom b
         JOIN items i ON i.id = b.finished_item_id
         WHERE b.id = $1`,
        [data.bomId]
      );

      if (!bomResult.rowCount) {
        throw fail(404, 'BOM not found');
      }

      const bom = bomResult.rows[0];

      const settings = await query(
        c,
        `SELECT variance_tolerance_pct
         FROM production_settings
         WHERE id = 1`
      );

      const tolerance =
        settings.rows[0].variance_tolerance_pct;

      const lines = (
        await query(
          c,
          `SELECT l.*, i.unit, i.sku,
                  i.units_per_carton
           FROM bom_lines l
           JOIN items i ON i.id = l.item_id
           WHERE l.bom_id = $1`,
          [data.bomId]
        )
      ).rows;

      const issueMap = new Map(
        data.issues.map(issue => [
          String(issue.itemId),
          issue
        ])
      );

      if (
        issueMap.size !== data.issues.length ||
        lines.length !== data.issues.length ||
        lines.some(
          l => !issueMap.has(String(l.item_id))
        )
      ) {
        throw fail(
          400,
          'Issues must include each BOM line exactly once'
        );
      }

      const output = D(data.goodOutput);

      if (
        !output.isFinite() ||
        !output.gt(0) ||
        !output.isInteger()
      ) {
        throw fail(400, 'Good output must be a positive whole number');
      }

      let cost = D(0);
      const calculated = [];
      const alerts = [];

      for (const line of lines) {

        const issue = issueMap.get(
          String(line.item_id)
        );

        let issued;
        let damaged;

        try {
          issued = convertQuantity(
            issue.quantity,
            issue.unit ?? line.unit,
            line.unit,
            line.units_per_carton
          );

          damaged = convertQuantity(
            issue.damagedQty ?? 0,
            issue.unit ?? line.unit,
            line.unit,
            line.units_per_carton
          );
        } catch (error) {
          throw fail(
            400,
            `${line.sku}: ${error.message}`
          );
        }

        if (
          !issued.gt(0) ||
          damaged.gt(issued) ||
          issued.decimalPlaces() > 4 ||
          damaged.decimalPlaces() > 4
        ) {
          throw fail(
            400,
            `Invalid issue quantity for ${line.sku}`
          );
        }

        if (
          ['piece', 'packet', 'carton'].includes(line.unit) &&
          (!issued.isInteger() || !damaged.isInteger())
        ) {
          throw fail(
            400,
            `${line.sku} requires whole units`
          );
        }

        const stock = await balance(c, line.item_id);

        if (stock.lt(issued)) {
          throw fail(
            409,
            `Insufficient stock for ${line.sku}`
          );
        }

        const valuation = await query(
          c,
          `SELECT
             COALESCE(SUM(
               CASE WHEN source_type IN ('OPENING','PURCHASE')
               THEN delta * unit_cost ELSE 0 END
             ),0)::text AS v,
             COALESCE(SUM(
               CASE WHEN source_type IN ('OPENING','PURCHASE')
               THEN delta ELSE 0 END
             ),0)::text AS q
           FROM stock_movements
           WHERE item_id = $1`,
          [line.item_id]
        );

        const { v, q } = valuation.rows[0];

        const rate = D(q).isZero()
          ? D(0)
          : D(v).div(q);

        cost = cost.plus(issued.mul(rate));

        const variancePct = variance(
          issued,
          line.planned_qty
        );

        if (varianceAlert(variancePct, tolerance)) {
          alerts.push({
            type: 'MATERIAL',
            sku: line.sku,
            variancePct
          });
        }

        calculated.push({
          line,
          issued,
          damaged,
          variancePct
        });
      }

      const overhead = labour.plus(energy);
      const total = cost.plus(overhead);

      const yieldVariancePct = variance(
        output,
        bom.expected_output
      );

      if (varianceAlert(yieldVariancePct, tolerance)) {
        alerts.push({
          type: 'YIELD',
          variancePct: yieldVariancePct
        });
      }

      const r = await query(
        c,
        `INSERT INTO production_runs (
           request_key,
           bom_id,
           good_output,
           expected_output,
           material_cost,
           overhead,
           cost_per_packet,
           variance_tolerance_pct,
           selling_price_snapshot,
           labour_cost,
           energy_cost
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
         )
         RETURNING *`,
        [
          data.requestKey,
          data.bomId,
          output.toFixed(),
          bom.expected_output,
          money(cost),
          money(overhead),
          money(total.div(output)),
          tolerance,
          bom.selling_price,
          money(labour),
          money(energy)
        ]
      );

      const run = r.rows[0];

      for (const x of calculated) {
        await debit(
          c,
          x.line.item_id,
          x.issued,
          'PRODUCTION_ISSUE',
          run.id,
          String(x.line.item_id),
          req.user.id
        );

        await query(
          c,
          `INSERT INTO production_issues (
             run_id,
             item_id,
             qty,
             damaged_qty,
             planned_qty,
             variance_pct
           )
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            run.id,
            x.line.item_id,
            x.issued.toFixed(),
            x.damaged.toFixed(),
            x.line.planned_qty,
            x.variancePct
          ]
        );
      }

      await query(
        c,
        `INSERT INTO stock_movements (
           item_id, delta, source_type,
           source_id, line_key
         )
         VALUES ($1,$2,$3,$4,$5)`,
        [
          bom.finished_item_id,
          output.toFixed(),
          'PRODUCTION_OUTPUT',
          run.id,
          'good'
        ]
      );

      const margin =
        bom.selling_price != null &&
        D(bom.selling_price).gt(0)
          ? productionMargin(
              cost,
              overhead,
              output,
              bom.selling_price
            )
          : null;

      await audit(
        c,
        req.user.id,
        'PRODUCTION_RUN',
        run.id,
        'POSTED',
        {
          yieldVariancePct,
          tolerancePct: tolerance,
          alerts,
          margin
        }
      );

      return {
        run,
        yieldVariancePct,
        tolerancePct: tolerance,
        alerts,
        margin,
        replayed: false
      };
    });

    res.status(
      result.replayed ? 200 : 201
    ).json(result);
  })
);

//const overhead=D(data.labour).plus(data.energy);const total=cost.plus(overhead);const r=await query(c,'INSERT INTO production_runs(request_key,bom_id,good_output,expected_output,material_cost,overhead,cost_per_packet) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[data.requestKey,data.bomId,data.goodOutput,bom.rows[0].expected_output,money(cost),money(overhead),money(total.div(data.goodOutput))]);const run=r.rows[0];for(const x of calculated){await debit(c,x.line.item_id,x.issued,'PRODUCTION_ISSUE',run.id,String(x.line.item_id),req.user.id);await query(c,'INSERT INTO production_issues(run_id,item_id,qty,damaged_qty,planned_qty,variance_pct) VALUES($1,$2,$3,$4,$5,$6)',[run.id,x.line.item_id,x.issued.toFixed(),x.damaged.toFixed(),x.line.planned_qty,variance(x.issued,x.line.planned_qty)]);}await query(c,'INSERT INTO stock_movements(item_id,delta,source_type,source_id,line_key) VALUES($1,$2,$3,$4,$5)',[bom.rows[0].finished_item_id,data.goodOutput,'PRODUCTION_OUTPUT',run.id,'good']);await audit(c,req.user.id,'PRODUCTION_RUN',run.id,'POSTED',{yieldVariancePct:variance(data.goodOutput,bom.rows[0].expected_output)});return {run,yieldVariancePct:variance(data.goodOutput,bom.rows[0].expected_output),replayed:false};});res.status(result.replayed?200:201).json(result);}));

app.post(
  '/orders',
  auth('SALESMAN'),
  route(async (req, res) => {

    const d = z.object({
      requestKey: uuid,
      customerId: id,
      itemId: id,
      quantity: qty
    }).parse(req.body);

    const quantity = D(d.quantity);

    if (
      !quantity.isFinite() ||
      quantity.lte(0) ||
      quantity.decimalPlaces() > 4 ||
      quantity.gt('99999999999999.9999')
    ) {
      throw fail(400, 'Invalid order quantity');
    }

    const payload = {
      customerId: String(d.customerId),
      itemId: String(d.itemId),
      quantity: quantity.toFixed()
    };

    const result = await tx(async c => {

      // Serialize order submission retries.
      await query(
        c,
        'SELECT id FROM inventory_mutex WHERE id = 1 FOR UPDATE'
      );

      const existing = await query(
        c,
        `SELECT *
         FROM orders
         WHERE request_key = $1`,
        [d.requestKey]
      );

      if (existing.rowCount) {
        const order = existing.rows[0];

        if (
          String(order.salesman_id) !==
          String(req.user.id)
        ) {
          throw fail(403, 'Order belongs to another salesman');
        }

        const original = order.submission_payload;

        if (original) {
          if (
            String(original.customerId) !== payload.customerId ||
            String(original.itemId) !== payload.itemId ||
            !D(original.quantity).eq(quantity)
          ) {
            throw fail(
              409,
              'Request ID already used for a different order'
            );
          }
        } else {
          // Legacy orders created before migration 006.
          if (
            String(order.customer_id) !== payload.customerId ||
            String(order.item_id) !== payload.itemId ||
            !D(order.qty).eq(quantity)
          ) {
            throw fail(
              409,
              'Legacy request does not match the existing order'
            );
          }
        }

        return {
          order,
          replayed: true
        };
      }

      const customer = await query(
        c,
        'SELECT id FROM customers WHERE id = $1',
        [d.customerId]
      );

      if (!customer.rowCount) {
        throw fail(404, 'Customer not found');
      }

      const itemResult = await query(
        c,
        `SELECT id, kind, unit, selling_price
         FROM items
         WHERE id = $1`,
        [d.itemId]
      );

      if (!itemResult.rowCount) {
        throw fail(404, 'Product not found');
      }

      const item = itemResult.rows[0];

      if (item.kind !== 'FINISHED') {
        throw fail(
          400,
          'Only finished products can be ordered'
        );
      }

      if (
        item.selling_price == null ||
        D(item.selling_price).lte(0)
      ) {
        throw fail(
          400,
          'Product selling price is not configured'
        );
      }

      const discreteUnits = [
        'piece', 'pieces',
        'packet', 'packets',
        'carton', 'cartons',
        'pcs'
      ];

      if (
        discreteUnits.includes(
          String(item.unit).toLowerCase()
        ) &&
        !quantity.isInteger()
      ) {
        throw fail(
          400,
          'This product requires a whole-number quantity'
        );
      }

      const inserted = await query(
        c,
        `INSERT INTO orders (
          request_key,
          customer_id,
          salesman_id,
          item_id,
          qty,
          submission_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING *`,
        [
          d.requestKey,
          d.customerId,
          req.user.id,
          d.itemId,
          quantity.toFixed(),
          JSON.stringify(payload)
        ]
      );

      const order = inserted.rows[0];

      await audit(
        c,
        req.user.id,
        'ORDER',
        order.id,
        'SUBMITTED',
        {
          requestKey: d.requestKey,
          customerId: payload.customerId,
          itemId: payload.itemId,
          quantity: payload.quantity
        }
      );

      return {
        order,
        replayed: false
      };
    });

    res.status(result.replayed ? 200 : 201).json({
      ...result.order,
      replayed: result.replayed
    });
  })
);

app.post(
  '/orders/:id/edit',
  auth('ADMIN'),
  route(async (req, res) => {

    const d = z.object({
      quantity: qty,
      unitPrice: z.coerce.number()
        .positive()
        .max(999999999999)
        .refine(
          n => D(n).decimalPlaces() <= 2,
          'Price must have at most two decimal places'
        )
    }).parse(req.body);

    const result = await tx(async c => {

      const r = await query(
        c,
        `SELECT o.*, i.selling_price
         FROM orders o
         JOIN items i ON i.id = o.item_id
         WHERE o.id = $1
         FOR UPDATE OF o`,
        [req.params.id]
      );

      if (!r.rowCount) {
        throw fail(404, 'Order not found');
      }

      const o = r.rows[0];

      if (o.status !== 'SUBMITTED') {
        throw fail(
          409,
          'Only submitted orders can be edited'
        );
      }

      const updated = await query(
        c,
        `UPDATE orders
         SET qty = $2,
             unit_price = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [o.id, d.quantity, d.unitPrice]
      );

      await audit(
        c,
        req.user.id,
        'ORDER',
        o.id,
        'EDITED',
        {
          before: {
            quantity: o.qty,
            unitPrice: o.unit_price ?? o.selling_price
          },
          after: {
            quantity: updated.rows[0].qty,
            unitPrice: updated.rows[0].unit_price
          }
        }
      );

      return updated.rows[0];
    });

    res.json(result);
  })
);

app.post(
  '/orders/:id/reject',
  auth('ADMIN'),
  route(async (req, res) => {

    const d = z.object({
      reason: z.string().trim().min(3).max(500)
    }).parse(req.body);

    const result = await tx(async c => {

      const r = await query(
        c,
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [req.params.id]
      );

      if (!r.rowCount) {
        throw fail(404, 'Order not found');
      }

      const o = r.rows[0];

      if (o.status === 'REJECTED') {
        return o;
      }

      if (o.status !== 'SUBMITTED') {
        throw fail(
          409,
          'Only submitted orders can be rejected'
        );
      }

      const updated = await query(
        c,
        `UPDATE orders
         SET status = 'REJECTED',
             rejection_reason = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [o.id, d.reason]
      );

      await audit(
        c,
        req.user.id,
        'ORDER',
        o.id,
        'REJECTED',
        { reason: d.reason }
      );

      return updated.rows[0];
    });

    res.json(result);
  })
);


app.post(
  '/orders/:id/approve',
  auth('ADMIN'),
  route(async (req, res) => {

    const result = await tx(async c => {

      const r = await query(
        c,
        `SELECT o.*, i.kind, i.selling_price
         FROM orders o
         JOIN items i ON i.id = o.item_id
         WHERE o.id = $1
         FOR UPDATE OF o`,
        [req.params.id]
      );

      if (!r.rowCount) {
        throw fail(404, 'Order not found');
      }

      const o = r.rows[0];

      if (o.status === 'APPROVED') {
        return { status: o.status };
      }

      if (o.status !== 'SUBMITTED') {
        throw fail(409, 'Order cannot be approved');
      }

      if (o.kind !== 'FINISHED') {
        throw fail(
          409,
          'Only finished products can be sold'
        );
      }

      // Serialize stock availability checks
      await query(
        c,
        'SELECT id FROM inventory_mutex WHERE id = 1 FOR UPDATE'
      );

      const stock = await balance(c, o.item_id);

      const reserved = await query(
        c,
        `SELECT COALESCE(SUM(qty), 0)::text AS quantity
         FROM orders
         WHERE item_id = $1
           AND id <> $2
           AND status IN ('APPROVED', 'INVOICED')`,
        [o.item_id, o.id]
      );

      const available = stock.minus(
        reserved.rows[0].quantity
      );

      if (available.lt(o.qty)) {
        throw fail(
          409,
          `Shortage: ${D(o.qty).minus(
            D.max ? D.max(available, 0) :
              (available.lt(0) ? D(0) : available)
          ).toFixed()} packets`
        );
      }

      const approvedPrice =
        o.unit_price ?? o.selling_price;

      if (
        approvedPrice == null ||
        !D(approvedPrice).gt(0)
      ) {
        throw fail(409, 'Invalid selling price');
      }

      await query(
        c,
        `UPDATE orders
         SET status = 'APPROVED',
             unit_price = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [o.id, approvedPrice]
      );

      await audit(
        c,
        req.user.id,
        'ORDER',
        o.id,
        'APPROVED',
        {
          quantity: o.qty,
          unitPrice: approvedPrice,
          physicalStock: stock.toFixed(),
          reservedStock: reserved.rows[0].quantity,
          availableStock: available.toFixed()
        }
      );

      return { status: 'APPROVED' };
    });

    res.json(result);
  })
);


app.post(
  '/orders/:id/invoice',
  auth('ADMIN'),
  route(async (req, res) => {

    const result = await tx(async c => {

      // Retrieve and lock the order
      const r = await query(
        c,
        `SELECT
          o.*,
          COALESCE(o.unit_price, i.selling_price) AS selling_price,
          i.gst_rate,
          i.sku,
          i.name AS product_name,
          i.hsn_code,
          i.unit,
          cu.name AS customer_name,
          cu.address AS customer_address,
          cu.gstin AS customer_gstin,
          cu.state_code
        FROM orders o
        JOIN items i ON i.id = o.item_id
        JOIN customers cu ON cu.id = o.customer_id
        WHERE o.id = $1
        FOR UPDATE OF o`,
        [req.params.id]
      );

      if (!r.rowCount) {
        throw fail(404, 'Order not found');
      }

      const o = r.rows[0];

      // Prevent duplicate invoice generation
      const old = await query(
        c,
        'SELECT * FROM invoices WHERE order_id = $1',
        [o.id]
      );

      if (old.rowCount) {
        return old.rows[0];
      }

      if (o.status !== 'APPROVED') {
        throw fail(409, 'Order must be approved');
      }

      // GST calculation
      const t = tax(
        o.qty,
        o.selling_price,
        o.gst_rate,
        o.state_code === '33'
      );

      // Use the same timestamp for numbering and storage
      const issuedAt = new Date();

      // Automatic financial-year invoice number
      const number =
        `${financialYearPrefix(issuedAt)}-${String(o.id).padStart(5, '0')}`;

      // Preserve billing details at issuance
      const snapshot = billingSnapshot(o);

      const invoiceQuantity = snapshot.pricing?.quantity ?? inv.qty;

      const invoiceUnitPrice = snapshot.pricing?.unit_price ?? new Decimal(inv.taxable).div(invoiceQuantity).toFixed(2);

      // Create invoice
      const inv = await query(
        c,
        `INSERT INTO invoices (
          order_id,
          invoice_no,
          taxable,
          cgst,
          sgst,
          igst,
          total,
          billing_snapshot,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8::jsonb, $9
        )
        RETURNING *`,
        [
          o.id,
          number,
          t.taxable,
          t.cgst,
          t.sgst,
          t.igst,
          t.total,
          JSON.stringify(snapshot),
          issuedAt
        ]
      );

      // Update order status
      await query(
        c,
        "UPDATE orders SET status = 'INVOICED' WHERE id = $1",
        [o.id]
      );

      // Record audit event
      await audit(
        c,
        req.user.id,
        'INVOICE',
        inv.rows[0].id,
        'ISSUED'
      );

      return inv.rows[0];

    });

    res.json(result);

  })
);
app.post('/invoices/:id/dispatch',auth('ADMIN'),route(async(req,res)=>{const result=await tx(async c=>{const r=await query(c,'SELECT i.id invoice_id,o.* FROM invoices i JOIN orders o ON o.id=i.order_id WHERE i.id=$1 FOR UPDATE OF o',[req.params.id]);if(!r.rowCount)throw fail(404,'Invoice not found');const o=r.rows[0];const old=await query(c,'SELECT * FROM dispatches WHERE invoice_id=$1',[o.invoice_id]);if(old.rowCount)return old.rows[0];if(o.status!=='INVOICED')throw fail(409,'Invoice not ready to dispatch');const d=await query(c,'INSERT INTO dispatches(invoice_id) VALUES($1) RETURNING *',[o.invoice_id]);await debit(c,o.item_id,o.qty,'DISPATCH',d.rows[0].id,'item',req.user.id);await query(c,"UPDATE orders SET status='DISPATCHED' WHERE id=$1",[o.id]);await audit(c,req.user.id,'DISPATCH',d.rows[0].id,'POSTED');return d.rows[0];});res.json(result);}));
app.post('/invoices/:id/payments',auth('ADMIN'),route(async(req,res)=>{const d=z.object({reference:text,amount:qty}).parse(req.body);const result=await tx(async c=>{const old=await query(c,'SELECT * FROM payments WHERE reference=$1',[d.reference]);if(old.rowCount)return old.rows[0];const inv=await query(c,'SELECT * FROM invoices WHERE id=$1',[req.params.id]);if(!inv.rowCount)throw fail(404,'Invoice not found');const paid=await query(c,'SELECT COALESCE(SUM(amount),0)::text n FROM payments WHERE invoice_id=$1',[req.params.id]);if(D(paid.rows[0].n).plus(d.amount).gt(inv.rows[0].total))throw fail(409,'Payment exceeds outstanding');const r=await query(c,'INSERT INTO payments(invoice_id,reference,amount) VALUES($1,$2,$3) RETURNING *',[req.params.id,d.reference,d.amount]);await audit(c,req.user.id,'PAYMENT',r.rows[0].id,'RECEIVED');return r.rows[0];});res.status(201).json(result);}));
app.get('/reports/receivables',auth('ADMIN','AUDITOR','OWNER'),route(async(req,res)=>res.json((await db.query('SELECT i.id,i.invoice_no,i.total,COALESCE(SUM(p.amount),0)::numeric(18,2) paid,(i.total-COALESCE(SUM(p.amount),0))::numeric(18,2) outstanding FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id GROUP BY i.id ORDER BY i.id')).rows)));

app.get(
  '/reports/production',
  auth('ADMIN', 'PRODUCTION', 'AUDITOR', 'OWNER'),
  route(async (req, res) => {

    const result = await db.query(`
      SELECT
        r.*,
        p.item_id,
        i.sku AS material_sku,
        i.unit AS material_unit,
        p.qty,
        p.planned_qty,
        p.damaged_qty,
        p.variance_pct,
        finished.sku AS finished_product,
        COALESCE(
          r.selling_price_snapshot,
          finished.selling_price
        ) AS reference_selling_price,
        COALESCE(
          r.variance_tolerance_pct,
          settings.variance_tolerance_pct
        ) AS effective_tolerance
      FROM production_runs r
      JOIN production_issues p ON p.run_id = r.id
      JOIN items i ON i.id = p.item_id
      JOIN bom b ON b.id = r.bom_id
      JOIN items finished
        ON finished.id = b.finished_item_id
      CROSS JOIN production_settings settings
      WHERE settings.id = 1
      ORDER BY r.id DESC, p.item_id
    `);

    const rows = result.rows.map(row => {

      const yieldVariancePct = variance(
        row.good_output,
        row.expected_output
      );

      const margin =
        row.reference_selling_price != null &&
        D(row.reference_selling_price).gt(0)
          ? productionMargin(
              row.material_cost,
              row.overhead,
              row.good_output,
              row.reference_selling_price
            )
          : null;

      return {
        ...row,
        yield_variance_pct: yieldVariancePct,
        yield_alert: varianceAlert(
          yieldVariancePct,
          row.effective_tolerance
        ),
        material_alert: varianceAlert(
          row.variance_pct,
          row.effective_tolerance
        ),
        profit_per_packet:
          margin?.profitPerPacket ?? null,
        margin_pct:
          margin?.marginPct ?? null,
        total_cost:
          money(D(row.material_cost).plus(row.overhead)),
        historical_price:
          row.selling_price_snapshot != null,
        historical_tolerance:
          row.variance_tolerance_pct != null
      };
    });

    res.json(rows);
  })
);


registerReports(app, db, auth, route);
registerDashboard(app, db, auth, route);
registerInvoicePdf(app, db, auth, route);
app.use((err,req,res,next)=>{const status=err instanceof z.ZodError?400:(err.status||((err.code==='23505'||err.code==='23503')?409:500));if(status===500)console.error('Request failed',err);res.status(status).json({error:status===500?'Internal server error':err instanceof z.ZodError?'Invalid input':err.message});});
const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log(`API listening on ${port}`));
