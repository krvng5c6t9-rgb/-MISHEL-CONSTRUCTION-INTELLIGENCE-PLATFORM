import { api, must } from './lib.mjs';
const T = process.env.BOOTSTRAP_ADMIN_TOKEN;
const a = await api('POST','/auth/bootstrap-admin',null,{organization:{name:'Tenant A Test Co',base_currency_code:'EGP'},full_name:'Admin A',email:'admin.a@test.local',password:'Passw0rd!A'},{'x-bootstrap-token':T});
console.log('A', a.status, a.data?.organization ?? a.body);
const b = await api('POST','/auth/bootstrap-admin',null,{organization:{name:'Tenant B Test Co',base_currency_code:'EGP'},full_name:'Admin B',email:'admin.b@test.local',password:'Passw0rd!B'},{'x-bootstrap-token':T});
console.log('B', b.status, b.data?.organization ?? b.body);
const ta=a.data.token;
const roles = must(await api('GET','/roles',ta),'roles'); console.log(roles.map(r=>`${r.id}:${r.role_name}`).join(' | '));
