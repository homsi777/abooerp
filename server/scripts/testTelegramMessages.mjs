// Quick test: send activation + agent shipment Telegram notifications
const BASE = 'http://127.0.0.1:4010/api/v1';

async function run() {
  // 1. Login
  const loginRes = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', branchCode: 'MAIN' }),
  });
  const login = await loginRes.json();
  const token = login.data?.session?.accessToken;
  if (!token) { console.error('❌ Login failed:', JSON.stringify(login)); process.exit(1); }
  console.log('✅ [1] Login OK');

  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

  // 2. Test activation bot (sends a test message to the configured bot)
  console.log('\n📨 [2] Testing activation bot message...');
  const actTestRes = await fetch(BASE + '/telegram/activation-settings/test', {
    method: 'POST', headers, body: JSON.stringify({}),
  });
  const actTestData = await actTestRes.json();
  if (actTestData.success) {
    console.log('✅ [2] Activation test message SENT successfully!');
  } else {
    console.log('❌ [2] Activation test failed:', actTestData.error ?? JSON.stringify(actTestData));
  }

  // 3. Activate with TEST1 — this triggers the real activation notification
  console.log('\n🔑 [3] Activating with TEST1 (triggers real activation notification)...');
  const activateRes = await fetch(BASE + '/license/activate', {
    method: 'POST', headers,
    body: JSON.stringify({ licenseCode: 'TEST1' }),
  });
  const activateData = await activateRes.json();
  if (activateData.success) {
    console.log('✅ [3] License activated:', activateData.data?.licenseType, '— activation notification sent to bot!');
  } else {
    console.log('ℹ️  [3] License activate response:', JSON.stringify(activateData));
  }

  // 4. Check if any agents exist for agent bot test
  console.log('\n👤 [4] Checking agents for agent bot test...');
  const agentsRes = await fetch(BASE + '/agents', { headers });
  const agentsData = await agentsRes.json();
  const agents = Array.isArray(agentsData.data) ? agentsData.data : [];
  console.log(`ℹ️  [4] Found ${agents.length} agent(s)`);

  // 5. Check agent bots configured
  const botsRes = await fetch(BASE + '/telegram/agent-bots', { headers });
  const botsData = await botsRes.json();
  const bots = Array.isArray(botsData.data) ? botsData.data : [];
  console.log(`ℹ️  [5] Agent bots registered: ${bots.length}`);

  if (bots.length > 0) {
    console.log('\n📦 [6] Testing first agent bot...');
    const testBotRes = await fetch(BASE + `/telegram/agent-bots/${bots[0].id}/test`, {
      method: 'POST', headers, body: JSON.stringify({}),
    });
    const testBotData = await testBotRes.json();
    if (testBotData.success) {
      console.log('✅ [6] Agent bot test message SENT!');
    } else {
      console.log('❌ [6] Agent bot test failed:', testBotData.error);
    }
  } else {
    console.log('\nℹ️  [6] No agent bots configured yet — add one from Settings > إعدادات تيليجرام');
  }

  console.log('\n✅ Test complete!');
}

run().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
