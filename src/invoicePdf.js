
import PDFDocument from 'pdfkit';
import Decimal from 'decimal.js';

export const supplier = {
  name: process.env.SUPPLIER_NAME || 'South Indian Snacks',
  address: process.env.SUPPLIER_ADDRESS || 'Tamil Nadu, India',
  gstin: process.env.SUPPLIER_GSTIN || 'DEMO - Not registered',
  state_code: '33'
};

export function financialYearPrefix(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(date);

  const year = Number(
    parts.find(p => p.type === 'year').value
  );

  const month = Number(
    parts.find(p => p.type === 'month').value
  );

  const startYear = month >= 4 ? year : year - 1;

  return `FY${String(startYear).slice(-2)}`;
}

export function billingSnapshot(row) {
  return {
    supplier: {
      ...supplier
    },

    customer: {
      name: row.customer_name,
      address: row.customer_address || 'Not provided',
      gstin: row.customer_gstin || 'Not provided',
      state_code: row.state_code
    },

    product: {
      sku: row.sku,
      name: row.product_name,
      hsn_code: row.hsn_code || 'Not configured',
      unit: row.unit
    },

    pricing: {
      quantity: String(row.qty),
      unit_price: row.selling_price == null
        ? null
        : String(row.selling_price),
      gst_rate: row.gst_rate == null
        ? null
        : String(row.gst_rate)
    }
  };
}

export function registerInvoicePdf(app, db, auth, route) {
  app.get(
    '/invoices/:id/pdf',
    auth('ADMIN', 'AUDITOR', 'OWNER'),
    route(async (req, res) => {
      if (!/^[1-9]\d{0,17}$/.test(req.params.id)) {
        return res.status(400).json({
          error: 'Invalid invoice ID'
        });
      }

      const result = await db.query(`
        SELECT
          i.*,
          o.qty,
          c.name AS customer_name,
          c.address AS customer_address,
          c.gstin AS customer_gstin,
          c.state_code,
          p.sku,
          p.name AS product_name,
          p.hsn_code,
          p.unit
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        JOIN items p ON p.id = o.item_id
        WHERE i.id = $1
      `, [req.params.id]);

      if (!result.rows.length) {
        return res.status(404).json({
          error: 'Invoice not found'
        });
      }

      const inv = result.rows[0];

      const snapshot =
        inv.billing_snapshot || billingSnapshot(inv);

      const seller = snapshot.supplier;
      const customer = snapshot.customer;
      const product = snapshot.product;

      const money = value =>
        new Decimal(value).toFixed(2);

      const rate = new Decimal(inv.taxable)
        .div(inv.qty)
        .toFixed(2);

      const taxRate = value =>
        new Decimal(inv.taxable).isZero()
          ? '0.00'
          : new Decimal(value)
              .div(inv.taxable)
              .mul(100)
              .toFixed(2);

      const date = new Date(inv.created_at)
        .toLocaleDateString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        });

      const interstate =
        customer.state_code !== seller.state_code;

      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Invoice ${inv.invoice_no}`,
          Author: seller.name
        }
      });

      const chunks = [];

      const pdfReady = new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
      });

      const navy = '#172B4D';
      const grey = '#64748B';
      const ink = '#17233B';
      const width = doc.page.width - 80;

      function rule(y) {
        doc.moveTo(40, y)
          .lineTo(40 + width, y)
          .strokeColor('#CBD5E1')
          .lineWidth(0.7)
          .stroke();
      }

      // Supplier header
      doc.font('Helvetica-Bold')
        .fontSize(19)
        .fillColor(navy)
        .text(seller.name, 40, 42, {
          width: 300
        });

      doc.font('Helvetica')
        .fontSize(10)
        .fillColor(grey)
        .text(seller.address, 40, doc.y + 5, {
          width: 290
        });

      doc.text(`GSTIN: ${seller.gstin}`, {
        width: 290
      });

      doc.font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(navy)
        .text('TAX INVOICE', 350, 43, {
          width: 205,
          align: 'right'
        });

      doc.font('Helvetica')
        .fontSize(11)
        .fillColor(ink)
        .text(inv.invoice_no, 350, 70, {
          width: 205,
          align: 'right'
        });

      doc.text(date, 350, 87, {
        width: 205,
        align: 'right'
      });

      rule(125);

      // Demonstration notice
      doc.font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#92400E')
        .text(
          'DEMONSTRATION INVOICE - NOT FOR TAX FILING',
          40, 137
        );

      // Customer details
      doc.font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(grey)
        .text('BILL TO', 40, 168);

      doc.fontSize(14)
        .fillColor(ink)
        .text(customer.name, 40, 187, {
          width: 250
        });

      doc.font('Helvetica')
        .fontSize(10)
        .text(customer.address, {
          width: 250
        });

      doc.text(`GSTIN: ${customer.gstin}`, {
        width: 250
      });

      doc.text(`State code: ${customer.state_code}`);

      // Supply information
      doc.font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(grey)
        .text('SUPPLY DETAILS', 330, 168);

      doc.font('Helvetica')
        .fillColor(ink)
        .text(
          `Place of supply: ${customer.state_code}`,
          330, 188
        );

      doc.text(
        `Supply type: ${interstate
          ? 'Interstate'
          : 'Intrastate'}`
      );

      doc.text(`Order reference: #${inv.order_id}`);

      // Product table
      const tableY = 285;

      doc.rect(40, tableY, width, 30)
        .fill(navy);

      doc.font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#FFFFFF');

      doc.text('Product / HSN', 50, tableY + 10);
      doc.text('Qty', 290, tableY + 10);
      doc.text('Rate (INR)', 350, tableY + 10);
      doc.text('Amount (INR)', 450, tableY + 10);

      doc.font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(ink)
        .text(product.name, 50, tableY + 45, {
          width: 220
        });

      doc.font('Helvetica')
        .fontSize(9)
        .fillColor(grey)
        .text(`SKU: ${product.sku}`, {
          width: 220
        });

      doc.text(`HSN: ${product.hsn_code}`, {
        width: 220
      });

      doc.fillColor(ink)
        .fontSize(10)
        .text(
          new Decimal(inv.qty).toString(),
          290, tableY + 45
        );

      doc.text(rate, 350, tableY + 45);

      doc.text(
        money(inv.taxable),
        450, tableY + 45,
        { width: 95, align: 'right' }
      );

      rule(390);

      // Tax summary
      let y = 410;

      function amountLine(label, amount) {
        doc.font('Helvetica')
          .fontSize(11)
          .fillColor(ink)
          .text(label, 300, y, {
            width: 145
          });

        doc.text(money(amount), 450, y, {
          width: 95,
          align: 'right'
        });

        y += 26;
      }

      amountLine('Taxable value', inv.taxable);

      amountLine(
        `CGST (${taxRate(inv.cgst)}%)`,
        inv.cgst
      );

      amountLine(
        `SGST (${taxRate(inv.sgst)}%)`,
        inv.sgst
      );

      amountLine(
        `IGST (${taxRate(inv.igst)}%)`,
        inv.igst
      );

      // Grand total
      doc.rect(290, y + 5, 265, 48)
        .fill('#EEF2F7');

      doc.font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(navy)
        .text('Grand Total', 302, y + 22);

      doc.text(
        `INR ${money(inv.total)}`,
        410, y + 22,
        { width: 135, align: 'right' }
      );

      rule(640);

      doc.font('Helvetica')
        .fontSize(10)
        .fillColor(grey)
        .text(
          'Computer-generated demonstration invoice.',
          40, 657
        );

      if (!inv.billing_snapshot) {
        doc.fontSize(9).text(
          'Legacy invoice: billing details reconstructed from current masters.',
          40, 675,
          { width: 350 }
        );
      }

      doc.font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(ink)
        .text('Authorized Signatory', 365, 710, {
          width: 190,
          align: 'right'
        });

      doc.font('Helvetica')
        .fontSize(9)
        .fillColor(grey)
        .text('Order-to-Audit System', 40, 765, {
          width,
          align: 'center'
        });

      doc.end();

      const pdf = await pdfReady;

      const filename = inv.invoice_no.replace(
        /[^a-zA-Z0-9_-]/g, '_'
      );

      res.setHeader('Content-Type', 'application/pdf');

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.pdf"`
      );

      res.setHeader('Cache-Control', 'private, no-store');

      res.send(pdf);
    })
  );
}
