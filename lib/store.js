import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const CITIES = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { name: 'Delhi', lat: 28.6139, lng: 77.209 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 }
];

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const clean = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const coordinate = value => value === '' || value === null || value === undefined ? null : Number(value);
export function validateDonor(input) {
  const name = clean(input.name, 80), phone = clean(input.phone, 24), email = clean(input.email, 120);
  const city = clean(input.city, 80), area = clean(input.area, 100), bloodGroup = clean(input.bloodGroup, 3);
  if (name.length < 2) throw new InputError('Enter a name with at least 2 characters.');
  if (!GROUPS.includes(bloodGroup)) throw new InputError('Choose a valid blood group.');
  if (!/^\+?[\d ()-]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7) throw new InputError('Enter a valid phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Enter a valid email address.');
  if (city.length < 2) throw new InputError('Enter a city.');
  if (typeof input.available !== 'boolean') throw new InputError('Availability must be true or false.');
  let lat = coordinate(input.lat), lng = coordinate(input.lng);
  if ((lat === null) !== (lng === null)) throw new InputError('Provide both latitude and longitude.');
  if (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) throw new InputError('Enter valid location coordinates.');
  const known = CITIES.find(c => c.name.toLowerCase() === city.toLowerCase());
  const locationPrecision = lat !== null ? 'exact' : known ? 'city' : 'unknown';
  if (lat === null && known) { lat = known.lat; lng = known.lng; }
  const lastDonation = clean(input.lastDonation, 10);
  if (lastDonation && (!/^\d{4}-\d{2}-\d{2}$/.test(lastDonation) || !Number.isFinite(Date.parse(lastDonation)) || new Date(lastDonation).toISOString().slice(0, 10) !== lastDonation || lastDonation > new Date().toISOString().slice(0, 10))) throw new InputError('Last donation must be a valid date in the past.');
  return { name, phone, email, city: known?.name || city, area, bloodGroup, available: input.available, lat, lng, locationPrecision, lastDonation, notes: clean(input.notes, 500) };
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}

export function createStore(filename, { seed = true } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS donors (id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, profile TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, action TEXT NOT NULL, name TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const fromRow = row => row ? JSON.parse(row.profile) : null;
  const get = id => fromRow(db.prepare('SELECT profile FROM donors WHERE id = ?').get(id));
  const all = () => db.prepare('SELECT profile FROM donors').all().map(fromRow);
  const log = (action, name) => db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?)').run(randomUUID(), action, name, new Date().toISOString());
  function save(input, id, isDemo = false) {
    const previous = id ? get(id) : null;
    if (id && !previous) throw new InputError('Donor not found.', 404);
    const valid = validateDonor(input);
    valid.phone = valid.phone.replace(/[ ()-]/g, '');
    const duplicate = db.prepare('SELECT id FROM donors WHERE phone = ?').get(valid.phone);
    if (duplicate && duplicate.id !== id) throw new InputError('A donor with this phone number already exists.', 409);
    const donor = { ...valid, id: id || randomUUID(), isDemo: previous?.isDemo ?? isDemo, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO donors VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET phone = excluded.phone, profile = excluded.profile').run(donor.id, donor.phone, JSON.stringify(donor));
      log(id ? 'updated' : 'registered', donor.name);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return donor;
  }
  function remove(id) {
    const donor = get(id);
    if (!donor) throw new InputError('Donor not found.', 404);
    db.exec('BEGIN');
    try { db.prepare('DELETE FROM donors WHERE id = ?').run(id); log('removed', donor.name); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function search(params = new URLSearchParams()) {
    const q = (params.get('q') || '').toLowerCase().trim();
    const group = params.get('group'), city = params.get('city'), available = params.get('available');
    const lat = coordinate(params.get('lat')), lng = coordinate(params.get('lng'));
    const radius = Number(params.get('radius') || 50);
    if ((lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180))) throw new InputError('Provide valid search coordinates.');
    if (!Number.isFinite(radius) || radius <= 0 || radius > 20000) throw new InputError('Radius must be between 0 and 20,000 km.');
    let result = all().filter(d => (!q || [d.name, d.city, d.area, d.phone].some(v => v.toLowerCase().includes(q))) && (!group || d.bloodGroup === group) && (!city || d.city.toLowerCase() === city.toLowerCase()) && (!available || String(d.available) === available));
    if (lat !== null) result = result.filter(d => d.lat !== null && d.lng !== null).map(d => ({ ...d, distance: distanceKm(lat, lng, d.lat, d.lng) })).filter(d => d.distance <= radius).sort((a, b) => a.distance - b.distance);
    else result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }
  if (seed && !db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
    const names = ['Aarav Sharma', 'Priya Nair', 'Arjun Reddy', 'Sneha Iyer', 'Rahul Verma', 'Ananya Rao', 'Vikram Patel', 'Meera Krishnan', 'Rohan Das', 'Diya Menon', 'Aditya Singh', 'Kavya Kumar'];
    const cities = ['Bengaluru', 'Bengaluru', 'Hyderabad', 'Chennai', 'Delhi', 'Bengaluru', 'Mumbai', 'Chennai', 'Kolkata', 'Coimbatore', 'Pune', 'Bengaluru'];
    const areas = ['Indiranagar', 'Koramangala', 'Banjara Hills', 'Adyar', 'Saket', 'Whitefield', 'Andheri West', 'Anna Nagar', 'Salt Lake', 'RS Puram', 'Kothrud', 'Jayanagar'];
    for (let i = 0; i < names.length; i++) save({ name: names[i], phone: `00000000${String(i).padStart(2, '0')}`, email: `demo${i + 1}@example.com`, city: cities[i], area: areas[i], bloodGroup: GROUPS[i % 8], available: i % 4 !== 2, lastDonation: '', notes: 'Fictional sample profile for exploring LifeLink.' }, undefined, true);
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run('seeded', 'true');
  }
  return { get, all, save, remove, search, activity: () => db.prepare('SELECT * FROM activity ORDER BY at DESC, rowid DESC LIMIT 100').all(), close: () => db.close() };
}
