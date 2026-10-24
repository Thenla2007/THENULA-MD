# THENUWA XMD — Local WhatsApp Bot Dashboard

A local-first dashboard with QR pairing, phone-number pairing code, command menu, optional AI chat, and basic message/command statistics.

> **Important:** This project uses the unofficial WhatsApp Web protocol through Baileys, not the official WhatsApp Business Platform. Use responsibly and at your own risk. Keep the dashboard bound to `127.0.0.1` unless you know how to secure remote access. Never share QR codes, pairing codes, or the `auth_info/` folder.

## Requirements

- Node.js 20 or newer
- npm (installed with Node.js)
- A WhatsApp account on your phone
- Optional: an OpenAI API key for `.ai` and the dashboard AI test

## Setup (Windows / Linux / Termux)

1. Extract the `THENUWA-XMD.zip` file into a folder.
2. Open a terminal in that folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - Linux/macOS/Termux: `cp .env.example .env`

5. Open `.env` and set `ADMIN_PASSWORD` to a unique random password of at least 16 characters. Optionally set `OWNER_NUMBER`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. Do not share `.env`.
6. Start the app:

   ```bash
   npm start
   ```

7. Open **http://127.0.0.1:3000** on the same device. Sign in using your `ADMIN_PASSWORD`.

Keep the terminal running while the bot is in use.

## Connect WhatsApp using QR

1. Sign in to the dashboard.
2. Click **Start connection** and wait for the QR code.
3. On your phone, open WhatsApp → **Settings** (or menu) → **Linked devices** → **Link a device**.
4. Scan the QR code shown on the dashboard.

## Connect using a pairing code

1. Sign in and click **Start connection** first.
2. Wait a few seconds until the connection initializes.
3. Enter your WhatsApp phone number with country code, digits only (example format: `94771234567`).
4. Click **Generate pairing code**.
5. In WhatsApp, open **Linked devices** → **Link a device** → **Link with phone number instead**, then enter the code.

WhatsApp/Baileys may change pairing requirements. If pairing fails, try the QR method and check the terminal for errors.

## Commands

Send these commands to the connected bot chat:

- `.menu` — list commands
- `.ping` — response check
- `.about` — bot information
- `.owner` — show configured owner link (set `OWNER_NUMBER`)
- `.ai your question` — optional AI reply (requires `OPENAI_API_KEY`)

AI API usage may incur costs. Without an API key, AI commands explain how to enable the feature.

## Statistics and limitations

The dashboard tracks message counts and command counts in memory since the current server start. They reset when the server restarts. This starter project does not persist analytics or provide multi-user roles. The dashboard login token is kept in browser session storage.

## Troubleshooting

- **`npm` or `node` not found:** install Node.js 20+ (Termux: `pkg update && pkg install nodejs-lts` if available in your repository).
- **Port already in use:** change `PORT=3000` in `.env` to another port.
- **QR never appears:** check terminal output and internet connection; try restarting the server.
- **Pairing endpoint says wait:** click Start connection, wait several seconds, then retry.
- **Logged out / auth expired:** stop the server and remove `auth_info/` only if you intend to pair the device again. This requires scanning/linking again.
- **AI not enabled:** set `OPENAI_API_KEY` in `.env` and restart.

## Security notes

- Default host is `127.0.0.1` so the panel is accessible only from the local device.
- Do not set `HOST=0.0.0.0` or expose port 3000 to the internet without adding HTTPS, stronger session management, CSRF protection, and a proper deployment setup.
- Never commit `.env`, `auth_info/`, QR images, or pairing codes to GitHub.
- Do not use this bot for bulk unsolicited messaging or spam.
