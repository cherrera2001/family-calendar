# Hallway Calendar

A web app for iPad (or any browser) that shows the **week ahead** from multiple iCal-subscribed calendars, plus weather. Designed for a shared display in a hallway so everyone can see what’s planned.

## Features

- **Multiple iCal calendars** – Subscribe to several .ics URLs (Google Calendar, Outlook, etc.), each with a name and color.
- **Week view** – One week at a time with previous/next and “This week”.
- **Weather** – 7-day forecast from [Open-Meteo](https://open-meteo.com) (no API key). Set latitude/longitude in Settings.
- **Settings** – Add/remove calendar URLs, names, colors, and weather location. Stored in the browser (localStorage).
- **Auto-refresh** – Calendars are refetched every 5 minutes.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Run in development**

   - Start both the API server and the Vite dev server:

   ```bash
   npm run dev
   ```

   - Open **http://localhost:5173** in your browser (or on your iPad on the same network). The dev server proxies `/api` to the backend.

3. **Configure**

   - Tap the **⚙ Settings** button.
   - Add one or more **Calendars**: name, subscription URL, and color.
   - Set **Weather location** (latitude/longitude) for the forecast.
   - Save.

## Running on iPad in the hallway

**Option A – Development**

- Run `npm run dev` on a computer on your network.
- On the iPad, open Safari and go to `http://<your-computer-ip>:5173`.
- Add to Home Screen for a full-screen app-like experience.

**Option B – Production (single machine)**

1. Build the frontend:

   ```bash
   npm run build
   ```

2. Start the server (serves the built app and the `/api` proxy):

   ```bash
   npm start
   ```

3. Set the port if needed: `PORT=3000 npm start`.
4. On the iPad, open `http://<server-ip>:3000` and add to Home Screen.

**Environment variables** (e.g. in Portainer or Docker)

- `PORT` – Server port (default `3001`).
- `CALENDAR_TITLE` – Header title shown in the app (default `Herrera House`).
- `REFRESH_PAGE_MINUTES` – Full page reload interval in minutes (e.g. `60` for hourly). Set to refresh the hallway display periodically; omit or `0` to disable.

**iCal URLs**

- **Google Calendar**: Calendar settings → Integrate calendar → Secret address in iCal format.
- **Outlook**: Calendar → Share → Get a link → ICS.
- Other services that provide an “iCal” or “ICS” subscription link work the same way.

Calendars are fetched via the app’s backend (to avoid CORS), so the server must be able to reach those URLs.

## Tech

- **Frontend**: React, TypeScript, Vite.
- **Backend**: Node (Express) – serves the app and proxies iCal feeds at `/api/ical?url=...`.
- **Parsing**: [ical.js](https://github.com/kewisch/ical.js) in the browser.
- **Weather**: [Open-Meteo](https://open-meteo.com) (no API key, CORS-friendly).
