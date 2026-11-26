// CC-107 / Stage 71 (migrations 105-106): MARC supplier directory. Directory records are TEST FIXTURES inserted with the
// owner role (as the platform loader does); the real collected data is not part of the repository or the gate.
import { ADMIN, ADMIN_B, TAG, api, must, check, expectStatus, login, sql, finish } from './harness.mjs';

const OWNER = process.env.OWNER_PSQL_URL, APP = process.env.APP_PSQL_URL;
const one = (text) => { const r = sql(OWNER, text); if (!r.ok) throw new Error(r.out.slice(0, 300)); return r.out; };
try {
  const admin = await login(ADMIN);
  const mk = async (key, perms) => {
    const roleId = must(await api('POST', '/roles', admin, { role_name: `DR ${key} ${TAG}`, permissions: perms.map(([module, action]) => ({ module, action, scope: 'all' })) }), 'role').id;
    const u = { email: `${key}.${TAG}@test.local`, password: `Passw0rd!${key}`, org_id: ADMIN.org_id };
    must(await api('POST', '/users', admin, { role_id: roleId, full_name: `DR ${key}`, email: u.email, password: u.password }), `user ${key}`);
    return login(u);
  };
  const viewer = await mk('drview', [['vendors', 'view']]);
  const buyer = await mk('drbuy', [['vendors', 'view'], ['vendors', 'create']]);
  const none = await mk('drnone', [['crm', 'view']]);
  // Fixtures: three countries, trades, one record without phone, one rejected.
  const ins = (c, name, city, phones, trades, extra = '') => one(`with s as (insert into directory_suppliers (country, name, city, address, phones, email, website, description, source, source_id, source_url, fetched_at, licence_status${extra ? ', verification_status' : ''})
    values ('${c}', '${name}', '${city}', '${city} street 1 (fixture)', ${phones.length ? `ARRAY[${phones.map(p => `'${p}'`).join(',')}]` : `'{}'`}::text[], 'sales.${TAG}@example.com', 'https://example.com',
      'Fixture supplier ${TAG}', 'fixture', '${TAG}-${name.replace(/\W+/g, '')}', 'https://example.com/${TAG}', now(), 'TEST FIXTURE'${extra ? `, '${extra}'` : ''}) returning id)
    insert into directory_supplier_trades (supplier_id, trade_code) select s.id, t from s, unnest(ARRAY[${trades.map(t => `'${t}'`).join(',')}]) t returning supplier_id`).split('\n')[0];
  const mEg = Number(ins('EG', `Nile Marble ${TAG}`, 'Cairo', ['02-27000000'], ['marble_granite']));
  const cSa = Number(ins('SA', `Riyadh Ceramics ${TAG}`, 'Riyadh', ['+966-11-0000000'], ['ceramic_porcelain', 'sanitary_ware']));
  const hAe = Number(ins('AE', `Gulf Cooling ${TAG}`, 'Dubai', [], ['hvac', 'chillers_cooling']));
  const lEg = Number(ins('EG', `Delta Lifts ${TAG}`, 'Alexandria', ['03-4000000', '0100000000'], ['elevators_escalators']));
  ins('EG', `Rejected Co ${TAG}`, 'Cairo', ['02-1'], ['marble_granite'], 'rejected');

  // --- Trades.
  const trades = must(await api('GET', '/directory/trades', viewer), 'trades');
  check('trade taxonomy: 11 groups with Arabic and English names; every trade has a parent group', trades.filter(t => !t.parent_code).length === 11
    && trades.every(t => t.name_ar && t.name_en) && trades.filter(t => t.parent_code).every(t => trades.some(g => g.code === t.parent_code && !g.parent_code)), String(trades.length));
  const fin = trades.find(t => t.code === 'finishing'), mg = trades.find(t => t.code === 'marble_granite');
  check('trade counts include their sub-trades and exclude rejected records', mg.suppliers >= 1 && fin.suppliers >= mg.suppliers
    && Number(one(`select count(*) from directory_supplier_trades st join directory_suppliers s on s.id = st.supplier_id where st.trade_code = 'marble_granite' and s.verification_status <> 'rejected'`)) === mg.suppliers);
  await expectStatus('the directory needs vendors.view', () => api('GET', '/directory/trades', none), 403);

  // --- Search.
  const byTrade = must(await api('GET', `/directory/suppliers?trade=marble_granite&q=${TAG}`, viewer), 'trade search');
  check('search by trade finds the supplier with its source and phones; a rejected record is never shown', byTrade.total === 1 && byTrade.rows[0].id === mEg
    && byTrade.rows[0].source === 'fixture' && byTrade.rows[0].phones[0] === '02-27000000' && byTrade.rows[0].verification_status === 'unverified', JSON.stringify(byTrade).slice(0, 300));
  const byGroup = must(await api('GET', `/directory/suppliers?trade=finishing&q=${TAG}`, viewer), 'group search');
  check('search by a group includes its sub-trades (marble + ceramic + sanitary)', byGroup.total === 2 && byGroup.rows.map(r => r.id).sort().join() === [mEg, cSa].sort().join());
  const ksa = must(await api('GET', `/directory/suppliers?country=SA&q=${TAG}`, viewer), 'country');
  check('search by country', ksa.total === 1 && ksa.rows[0].id === cSa && ksa.rows[0].trades.join() === 'ceramic_porcelain,sanitary_ware');
  const city = must(await api('GET', `/directory/suppliers?city=alexandria&q=${TAG}`, viewer), 'city');
  check('search by city (any letter case) shows every phone', city.total === 1 && city.rows[0].id === lEg && city.rows[0].phones.length === 2);
  const pct = must(await api('GET', `/directory/suppliers?q=${encodeURIComponent('%')}`, viewer), 'like');
  check('search text is matched literally (a % sign is not a wildcard)', pct.total === 0);
  const pg = must(await api('GET', `/directory/suppliers?q=${TAG}&page_size=2&page=2`, viewer), 'paging');
  check('paging: total, page size and second page', pg.total === 4 && pg.rows.length === 2 && pg.page === 2);
  await expectStatus('an unknown trade code format is refused', () => api('GET', '/directory/suppliers?trade=DROP%20TABLE', viewer), 400);
  await expectStatus('an unknown country is refused', () => api('GET', '/directory/suppliers?country=US', viewer), 400);
  const st = must(await api('GET', '/directory/stats', viewer), 'stats');
  check('statistics per country (suppliers, with phone)', ['EG', 'SA', 'AE'].every(c => st.some(x => x.country === c)) && st.find(x => x.country === 'AE').with_phone >= 0);

  // --- Adopt into the company's vendors.
  await expectStatus('adopting needs vendors.create', () => api('POST', `/directory/suppliers/${mEg}/adopt`, viewer, {}), 403);
  const ad = must(await api('POST', `/directory/suppliers/${mEg}/adopt`, buyer, { vendor_type: 'supplier' }), 'adopt');
  check('a directory supplier becomes the company\'s vendor (name, phone, trade) with its created event and link',
    one(`select v.vendor_name || '|' || v.phone || '|' || v.trade_category || '|' || (select count(*) from vendor_status_events e where e.vendor_id = v.id and e.event = 'created') from vendors_subcontractors v where v.id = ${ad.vendor_id}`)
      === `Nile Marble ${TAG}|02-27000000|Marble, granite and stone|1`
      && one(`select directory_supplier_id from vendor_directory_links where vendor_id = ${ad.vendor_id}`) === String(mEg));
  await expectStatus('the same directory supplier is not adopted twice', () => api('POST', `/directory/suppliers/${mEg}/adopt`, buyer, {}), 409);
  const after = must(await api('GET', `/directory/suppliers?trade=marble_granite&q=${TAG}`, buyer), 'after');
  check('the search marks the supplier as already one of my vendors', after.rows[0].my_vendor_id === ad.vendor_id);
  const noPhone = must(await api('POST', `/directory/suppliers/${hAe}/adopt`, buyer, { vendor_type: 'subcontractor' }), 'adopt no phone');
  check('a supplier without phone is adopted without inventing one', one(`select coalesce(phone, '-') || '|' || vendor_type from vendors_subcontractors where id = ${noPhone.vendor_id}`) === '-|subcontractor');
  const rej = Number(one(`select id from directory_suppliers where name = 'Rejected Co ${TAG}'`));
  await expectStatus('a rejected record cannot be adopted', () => api('POST', `/directory/suppliers/${rej}/adopt`, buyer, {}), 404);

  // --- Shared, read-only platform data; company links isolated.
  const adminB = await login(ADMIN_B);
  const bSee = must(await api('GET', `/directory/suppliers?trade=marble_granite&q=${TAG}`, adminB), 'B search');
  check('another company sees the same directory but not this company\'s adoption', bSee.total === 1 && bSee.rows[0].my_vendor_id === null);
  const bAd = must(await api('POST', `/directory/suppliers/${mEg}/adopt`, adminB, {}), 'B adopt');
  check('another company can adopt the same directory supplier into its own vendors', bAd.vendor_id !== ad.vendor_id);
  const w1 = sql(APP, `insert into directory_trades (code, name_en, name_ar) values ('x${TAG.toLowerCase()}', 'x', 'x')`);
  check('the application role cannot write the directory (row-level security)', !w1.ok && /row-level security/.test(w1.out), w1.out.slice(0, 120));
  const w2 = sql(APP, `update directory_suppliers set name = 'Changed' where id = ${mEg} returning id`);
  check('the application role cannot change a directory record (no row updated)', (w2.ok && /^(UPDATE 0)?$/.test(w2.out.trim())) || !w2.ok, w2.out.slice(0, 80));
  check('directory record unchanged', one(`select name from directory_suppliers where id = ${mEg}`) === `Nile Marble ${TAG}`);
  const del = sql(OWNER, `delete from vendor_directory_links where vendor_id = ${ad.vendor_id}`);
  check('a directory link is permanent (database)', !del.ok && /permanent/.test(del.out), del.out.slice(0, 120));
  check('adoption links are audited', Number(one(`select count(*) from audit_log where table_name = 'vendor_directory_links' and org_id = ${ADMIN.org_id}`)) >= 2);
} catch (e) {
  check('suite completed', false, e.message.slice(0, 300));
}
finish('sweep_directory');
