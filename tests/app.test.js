import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, distanceKm } from '../lib/store.js';
import { createApp } from '../server.js';
import { request as httpRequest } from 'node:http';

const profile = (changes = {}) => ({ name: 'Test Donor', phone: '+919876543210', bloodGroup: 'O+', available: true, city: 'Bengaluru', area: 'Indiranagar', email: 'test@example.com', lastDonation: '', ...changes });

test('profiles persist after reopening; update, uniqueness, delete, and activity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifelink-'));
  let store = createStore(join(dir, 'test.sqlite'), { seed: false });
  try {
    const d = store.save(profile());
    store.close(); store = createStore(join(dir, 'test.sqlite'), { seed: false });
    assert.equal(store.get(d.id).name, 'Test Donor');
    const changed = store.save(profile({ available: false, name: 'Updated Donor' }), d.id);
    assert.equal(changed.available, false); assert.equal(changed.createdAt, d.createdAt);
    assert.throws(() => store.save(profile({ phone: '+91 98765 43210' })), /already exists/);
    assert.equal(store.get(d.id).name, 'Updated Donor');
    store.remove(d.id); assert.equal(store.get(d.id), null);
    assert.deepEqual(store.activity().map(a => a.action), ['removed', 'updated', 'registered']);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('blood, city, availability, free text, radius, and distance ordering combine', () => {
  const s = createStore(':memory:', { seed: false });
  try {
    s.save(profile()); s.save(profile({ name: 'Nearby Donor', phone: '1111111111', lat: 12.972, lng: 77.595 }));
    s.save(profile({ name: 'Far Donor', phone: '2222222222', city: 'Chennai', available: false, bloodGroup: 'A-' }));
    s.save(profile({ name: 'Unlocated Donor', phone: '3333333333', city: 'Unknown city' }));
    const query = q => s.search(new URLSearchParams(q));
    assert.equal(query({ group: 'O+', city: 'bengaluru', available: 'true', q: 'indira' }).length, 2);
    assert.equal(query({ available: 'false' })[0].name, 'Far Donor');
    const nearby = query({ lat: '12.9716', lng: '77.5946', radius: '10' });
    assert.equal(nearby.length, 2); assert.equal(nearby[0].name, 'Test Donor');
    assert.equal(nearby[0].locationPrecision, 'city'); assert.equal(nearby[1].locationPrecision, 'exact');
    assert.equal(query({ group: 'AB-' }).length, 0);
    assert.throws(() => query({ lat: 'oops', lng: '77' }), /coordinates/);
    assert.throws(() => query({ lat: '12', lng: '77', radius: '-1' }), /Radius/);
    assert.ok(distanceKm(12.9716, 77.5946, 13.0827, 80.2707) > 280);
  } finally { s.close(); }
});
test('rejects invalid fields, invalid dates, and incomplete coordinates', () => {
  const s = createStore(':memory:', { seed: false });
  try {
    for (const changes of [{ name: '' }, { bloodGroup: 'C+' }, { phone: 'bad' }, { email: 'bad' }, { city: '' }, { available: 'yes' }, { lat: 91, lng: 1 }, { lat: 1 }, { lastDonation: '2099-01-01' }, { lastDonation: '2026-02-30' }]) assert.throws(() => s.save(profile(changes)));
    assert.equal(s.all().length, 0);
    assert.throws(() => s.remove('missing'), /not found/);
  } finally { s.close(); }
});
test('sample data seeds once and does not reappear after deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifelink-seed-')), file = join(dir, 'test.sqlite');
  let s = createStore(file);
  try { assert.equal(s.all().length, 12); assert.ok(s.all().every(d => d.isDemo)); for (const d of s.all()) s.remove(d.id); s.close(); s = createStore(file); assert.equal(s.all().length, 0); }
  finally { s.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('HTTP API CRUD, error responses, static resources, and cross-origin protection', async () => {
  const server = createApp({ database: ':memory:', seed: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const home = await request('/'); assert.equal(home.status, 200); assert.match(await home.text(), /Donor directory/); assert.ok(home.headers.get('content-security-policy'));
    for (const asset of ['/app.js', '/styles.css', '/favicon.svg']) assert.equal((await request(asset)).status, 200);
    assert.equal((await request('/api/meta')).status, 200);
    const created = await request('/api/donors', 'POST', profile()); assert.equal(created.status, 201);
    const { donor } = await created.json(); assert.equal(donor.isDemo, false);
    assert.equal((await request('/api/donors', 'POST', profile())).status, 409);
    const updated = await request(`/api/donors/${donor.id}`, 'PUT', profile({ available: false })); assert.equal(updated.status, 200);
    assert.equal((await (await request('/api/donors?available=true')).json()).donors.length, 0);
    assert.equal((await request('/api/donors', 'POST', profile({ name: '' }))).status, 400);
    assert.equal((await request('/api/donors', 'POST', profile(), { Origin: 'https://untrusted.example' })).status, 403);
    const invalidHostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(base, { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(invalidHostStatus, 403);
    const bad = await fetch(base + '/api/donors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }); assert.equal(bad.status, 400);
    assert.equal((await request('/api/donors', 'POST', null)).status, 400);
    assert.equal((await request('/api/donors', 'POST', profile(), { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request('/api/donors', 'POST', { ...profile(), notes: 'x'.repeat(17000) })).status, 413);
    assert.equal((await request('/server.js')).status, 404);
    assert.equal((await request('/api/donors/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await request(`/api/donors/${donor.id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/api/donors/${donor.id}`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
