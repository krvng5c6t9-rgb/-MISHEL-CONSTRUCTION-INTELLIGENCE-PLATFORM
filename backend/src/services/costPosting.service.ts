import type { PoolClient } from 'pg';
import { AppError } from '../middleware/errors.js';

export async function postCommittedCostForPurchaseOrder(client: PoolClient, poId: number) {
  const poResult = await client.query(`
    select id, project_id, cost_code_id, total_amount, currency_id, po_ref
    from purchase_orders
    where id = $1
    for update
  `, [poId]);
  const po = poResult.rows[0];
  if (!po) throw new AppError(404, 'Purchase order not found');
  if (!po.cost_code_id) throw new AppError(422, 'Purchase order cost_code_id is required before committed cost posting');

  const existing = await client.query(`
    select id from cost_transactions
    where source_module = 'procurement'
      and source_table = 'purchase_orders'
      and source_record_id = $1
      and transaction_type = 'committed'
    limit 1
  `, [poId]);
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(`
    insert into cost_transactions
      (project_id, cost_code_id, source_module, source_table, source_record_id,
       transaction_type, amount, currency_id, transaction_date, description)
    values
      ($1, $2, 'procurement', 'purchase_orders', $3,
       'committed', $4, $5, current_date, $6)
    returning *
  `, [po.project_id, po.cost_code_id, po.id, po.total_amount, po.currency_id, `Committed cost from PO ${po.po_ref}`]);

  return inserted.rows[0];
}

export async function postActualCostForVendorInvoice(client: PoolClient, invoiceId: number) {
  const invoiceResult = await client.query(`
    select vi.id, vi.project_id, vi.po_id, vi.amount, vi.tax_amount, vi.currency_id, vi.invoice_no,
           po.cost_code_id
    from vendor_invoices vi
    left join purchase_orders po on po.id = vi.po_id
    where vi.id = $1
    for update
  `, [invoiceId]);
  const invoice = invoiceResult.rows[0];
  if (!invoice) throw new AppError(404, 'Vendor invoice not found');
  if (!invoice.cost_code_id) throw new AppError(422, 'Vendor invoice must be linked to a PO with cost_code_id before actual cost posting');

  const existing = await client.query(`
    select id from cost_transactions
    where source_module = 'procurement'
      and source_table = 'vendor_invoices'
      and source_record_id = $1
      and transaction_type = 'actual'
    limit 1
  `, [invoiceId]);
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await client.query(`
    insert into cost_transactions
      (project_id, cost_code_id, source_module, source_table, source_record_id,
       transaction_type, amount, currency_id, transaction_date, description)
    select $1, $2, 'procurement', 'vendor_invoices', $3,
       'actual', (vi.amount + coalesce(vi.tax_amount,0))::numeric, $4, current_date, $5
    from vendor_invoices vi where vi.id=$3
    returning *
  `, [invoice.project_id, invoice.cost_code_id, invoice.id, invoice.currency_id, `Actual cost from vendor invoice ${invoice.invoice_no}`]);

  await client.query(`
    insert into accounts_payable
      (org_id, vendor_id, project_id, source_type, source_record_id, amount, currency_id, due_date)
    select p.org_id, vi.vendor_id, vi.project_id, 'vendor_invoice', vi.id,
           (vi.amount + vi.tax_amount), vi.currency_id, vi.due_date
    from vendor_invoices vi
    join projects p on p.id = vi.project_id
    where vi.id = $1
    on conflict (source_type, source_record_id) do nothing
  `, [invoice.id]);

  return inserted.rows[0];
}
