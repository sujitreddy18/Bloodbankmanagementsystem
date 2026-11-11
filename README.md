# LifeLink — Blood Donor Management

A responsive donor management web application with a Node.js API and a persistent SQLite database. No npm packages, API keys, or external services are required.

## Run

Install **Node.js 24 or later**, then from this directory:

```powershell
npm start
```

Open **http://127.0.0.1:3000**. For development with server restart on source changes, use `npm run dev` (refresh the browser after edits). Run the automated tests with `npm test`.

## Features

- Create, view, edit, and permanently remove donor profiles.
- Store name, blood group, phone, optional email, city, locality, availability, last donation date, coordinates, and notes.
- Search by name, locality, city, or phone; combine exact blood group, city, and availability filters.
- Search within 10–500 km of the browser's current location, sorted nearest first. Location permission is optional; city search works without it.
- Supported cities fall back to city-centre coordinates. An `≈` marks approximate distances. Custom cities without coordinates are excluded from radius searches. Provide precise coordinates in the profile form for accurate proximity results.
- View network statistics, available donors, recent activity, grid/list layouts, and paginated results.
- Validate profiles on the server and prevent duplicate normalized phone numbers.
- Changes persist across browser refreshes and server restarts in `data/lifelink.sqlite`.

The first run creates **12 fictional demo donors** with sample contacts. Each has a DEMO badge and disabled contact links. Demo profiles are never presented as real donors. Removing them will not cause them to reappear on restart.

To start a clean database without sample donors, set these variables before the first launch:

```powershell
$env:SEED_DEMO = 'false'
$env:DB_PATH = 'data/real-donors.sqlite'
npm start
```

Optional: `$env:PORT = '3001'` selects a different port. `DB_PATH` accepts an absolute path or one relative to the working directory. Copy the database for backup **after stopping the server**. Database files are excluded from Git.

## Project structure

```text
server.js           Local HTTP server, security headers, REST API
lib/store.js        SQLite persistence, validation, filters, distance calculation
public/index.html   Accessible application shell and native dialogs
public/styles.css   Responsive design
public/app.js       Search, donor CRUD, geolocation, activity, pagination
tests/app.test.js   Persistence, search, validation, and HTTP integration tests
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/meta` | Blood groups and supported city centres |
| GET | `/api/donors` | Search profiles |
| POST | `/api/donors` | Create profile |
| GET | `/api/donors/:id` | Read profile |
| PUT | `/api/donors/:id` | Replace profile fields |
| DELETE | `/api/donors/:id` | Remove profile |
| GET | `/api/activity` | Most recent 100 profile events |

Search parameters: `q`, `group` (URL-encode `+` as `%2B`), `city`, `available` (`true` / `false`), and `lat`, `lng`, `radius` (km). Coordinate searches omit profiles without coordinates. Blood group filtering matches the recorded group exactly; the app does not calculate transfusion compatibility.

Example profile JSON:

```json
{
  "name": "Example Donor",
  "phone": "+919876543210",
  "bloodGroup": "O+",
  "available": true,
  "city": "Bengaluru",
  "area": "Indiranagar",
  "email": "donor@example.com",
  "lastDonation": "",
  "lat": "",
  "lng": "",
  "notes": "Please call in the evening."
}
```

## Operating scope

This version is a **single-user local application**. It binds to `127.0.0.1` and rejects external hostnames and cross-origin requests. There is no login or multi-user authorization; anyone with access to the local workspace can access donor records. Use it with sample data for demonstrations. Before a shared or public deployment, add authentication, role-based access, consent management, HTTPS, and a suitable backup policy. No public deployment is configured.

Availability is self-reported and does not establish medical eligibility to donate. The application does not enforce medical donation intervals or make matching recommendations.

SQLite uses Node's built-in [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) module.
