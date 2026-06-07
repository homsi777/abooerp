const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function normalizeDestinationKey(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeAgentGovernorate(value) {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.replace(/^وكيل\s+/u, '').trim() || null;
}

function governorateLookupKey(governorate) {
  return normalizeDestinationKey(normalizeAgentGovernorate(governorate) ?? '');
}

function pickPreferredAgentForGovernorate(agents) {
  if (!agents.length) return null;
  if (agents.length === 1) return agents[0];
  const numeric = agents.filter((agent) => /^\d+$/.test(String(agent.code ?? '').trim()));
  if (numeric.length === 1) return numeric[0];
  const pool = numeric.length > 1 ? numeric : agents;
  return [...pool].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0] ?? null;
}

function dedupeAgentsForDestination(agents, destination) {
  if (agents.length <= 1) return agents;
  const destKey = governorateLookupKey(destination) || normalizeDestinationKey(destination);
  const byGovernorate = agents.filter((agent) => governorateLookupKey(agent.governorate) === destKey);
  if (!byGovernorate.length) return agents;
  if (byGovernorate.length === 1) return byGovernorate;
  const preferred = pickPreferredAgentForGovernorate(byGovernorate);
  return preferred ? [preferred] : byGovernorate;
}

async function currentLookup(pool, companyId, destination) {
  const normalized = normalizeDestinationKey(destination);
  const numericKey = /^\d+$/.test(destination.trim())
    ? destination.trim().replace(/^0+/, '') || '0'
    : null;
  const result = await pool.query(
    `
    select a.id, a.code, a.name, a.governorate, a.city, a.area
    from agents a
    join branches b on b.id = a.branch_id
    where b.company_id = $1
      and a.is_active = true
      and (
        lower(trim(coalesce(a.area, ''))) = $2
        or lower(trim(coalesce(a.city, ''))) = $2
        or lower(trim(coalesce(a.governorate, ''))) = $2
        or lower(trim(a.code)) = $2
        or (
          $3::text is not null
          and trim(a.code) ~ '^[0-9]+$'
          and coalesce(nullif(ltrim(trim(a.code), '0'), ''), '0') = $3
        )
      )
    order by a.created_at desc
    `,
    [companyId, normalized, numericKey],
  );
  return result.rows;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const company = await pool.query('select id, name from companies limit 5');
  console.log('Companies:', company.rows);

  const agents = await pool.query(`
    select a.id, a.code, a.name, a.governorate, a.city, a.area, a.is_active, b.company_id, c.name as company_name
    from agents a
    join branches b on b.id = a.branch_id
    join companies c on c.id = b.company_id
    where a.is_active = true
    order by c.name, a.governorate, a.code
  `);
  console.log('\nActive agents:', agents.rows.length);
  for (const row of agents.rows) {
    console.log(
      `- ${row.company_name} | ${row.code} | gov=${row.governorate} | city=${row.city} | area=${row.area}`,
    );
  }

  const companyId = agents.rows[0]?.company_id;
  if (!companyId) {
    console.log('No agents found');
    await pool.end();
    return;
  }

  const dests = ['الرقة', 'الحسكة', 'القامشلي'];
  console.log('\n=== Current lookupByDestination logic ===');
  for (const d of dests) {
    const rows = await currentLookup(pool, companyId, d);
    console.log(`${d}: ${rows.length} match(es)`, rows.map((r) => `${r.code}(gov=${r.governorate})`).join(', '));
  }

  console.log('\n=== After dedupe (new logic) ===');
  for (const d of dests) {
    const rows = dedupeAgentsForDestination(await currentLookup(pool, companyId, d), d);
    console.log(`${d}: ${rows.length} =>`, rows.map((r) => r.code).join(', '));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
