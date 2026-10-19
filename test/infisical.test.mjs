import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSettings, loadSettings } from '../scripts/infisical.mjs';
const values = {
  TELEGRAM_BOT_TOKEN: '123456:TEST_ONLY', TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(64),
  OAUTH_SIGNING_SECRET: 'b'.repeat(64), PUBLIC_BASE_URL: 'https://teacher.example',
  OAUTH_CLIENT_ID: 'teacher-test', OAUTH_REDIRECT_URIS: '[]'
};
const entries = input => Object.entries(input).map(([secretKey, secretValue]) => ({secretKey, secretValue}));
const config = { siteUrl: 'http://infisical.example', projectId: 'test-project', environment: 'prod', secretPath: '/' };
test('Infisical selection excludes unrelated infrastructure credentials', () => {
  assert.deepEqual(selectSettings(entries({...values, INFISICAL_CLIENT_SECRET:'DO_NOT_EXPORT', DATABASE_URL:'DO_NOT_EXPORT'})), values);
});
test('Infisical rejects missing, duplicate and invalid settings before upload', () => {
  assert.throws(() => selectSettings(entries({...values, TELEGRAM_BOT_TOKEN:''})), /Missing/);
  assert.throws(() => selectSettings([...entries(values), entries(values)[0]]), /Duplicate/);
  assert.throws(() => selectSettings(entries({...values, PUBLIC_BASE_URL:'http://teacher.example'})), /HTTPS origin/);
  assert.throws(() => selectSettings(entries({...values, OAUTH_SIGNING_SECRET:values.TELEGRAM_WEBHOOK_SECRET})), /independent/);
  assert.throws(() => selectSettings(entries({...values, OAUTH_REDIRECT_URIS:'"not-an-array"'})), /JSON array/);
});
test('Universal Auth reads only the configured project/environment/path and disallows redirects', async () => {
  const calls = [];
  const settings = await loadSettings(config, {clientId:'test-client', clientSecret:'test-secret'}, async (url, options) => {
    calls.push({url, options});
    if (calls.length === 1) return Response.json({accessToken:'ephemeral-test-token'});
    return Response.json({secrets:entries(values)});
  });
  assert.deepEqual(settings, values);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.headers.authorization, 'Bearer ephemeral-test-token');
  const query = new URL(calls[1].url).searchParams;
  assert.equal(query.get('projectId'), 'test-project');
  assert.equal(query.get('environment'), 'prod');
  assert.equal(query.get('secretPath'), '/');
  assert.equal(query.get('recursive'), 'false');
});
test('Infisical failures never reveal upstream response bodies', async () => {
  await assert.rejects(() => loadSettings(config, {clientId:'test', clientSecret:'SECRET_SENTINEL'},
    async () => new Response('SECRET_SENTINEL', {status:403})), error => !error.message.includes('SECRET_SENTINEL') && error.message.includes('403'));
});
test('legacy Infisical fallback keeps the same scope when v4 is unavailable', async () => {
  const calls=[];
  const result=await loadSettings(config,{clientId:'test',clientSecret:'secret'},async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1) return Response.json({accessToken:'test-access'});
    if(calls.length===2) return new Response('Not found',{status:404});
    return Response.json({secrets:entries(values)});
  });
  assert.deepEqual(result,values);
  const legacy=new URL(calls[2].url);
  assert.equal(legacy.pathname,'/api/v3/secrets/raw');
  assert.equal(legacy.searchParams.get('workspaceId'),config.projectId);
  assert.equal(legacy.searchParams.get('environment'),'prod');
  assert.equal(legacy.searchParams.get('secretPath'),'/');
  assert.equal(legacy.searchParams.get('include_imports'),'false');
});
test('Infisical never retries or falls back after a permission denial', async () => {
  let calls=0;
  await assert.rejects(()=>loadSettings(config,{clientId:'test',clientSecret:'secret'},async()=>{
    calls++;
    return calls===1 ? Response.json({accessToken:'test-access'}) : new Response('Forbidden',{status:403});
  }),/403/);
  assert.equal(calls,2);
});
