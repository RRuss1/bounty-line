# Deploy your own Bounty Board

This guide sets up the **Bounty Board** (the Discord bot) for **your** guild, on **your** own
Cloudflare account. You don't need to know how to code. Plan on about 30–45 minutes the
first time.

You'll copy a few values from Discord and Cloudflare into GitHub, then click one button. That
button (the **Bootstrap deployment** workflow) checks everything first and tells you, in plain
English, what to fix if something's wrong. **It never deletes anything, and you can run it as
many times as you like.**

> **Why does each guild run its own?** Your bounties, screenshots and member links stay in
> your own account, and your usage is your own bill (often free). Nobody else's bot ever
> sees your server.

---

## What you need

| | |
|---|---|
| **A Discord server** where you're an admin | You'll add the bot to it |
| **A Cloudflare account** | Free to sign up at [dash.cloudflare.com](https://dash.cloudflare.com). The Free plan works in *budget mode*; **Workers Paid** ($5/month) is recommended for reading pasted codes in chat and the AI screenshot check |
| **A GitHub account** | Free, at [github.com](https://github.com) |

Keep a text file open as you go: you'll collect **seven values** and paste them into GitHub
in step 5. Treat the three marked 🔒 like passwords. Never post them in Discord, never put
them in a file in your repo.

| # | Value | Where it comes from |
|---|---|---|
| 1 | `CLOUDFLARE_ACCOUNT_ID` | Step 2 |
| 2 | `CLOUDFLARE_API_TOKEN` 🔒 | Step 2 |
| 3 | `DISCORD_APP_ID` | Step 3 |
| 4 | `DISCORD_PUBLIC_KEY` | Step 3 |
| 5 | `DISCORD_TOKEN` 🔒 | Step 3 |
| 6 | `ALLOWED_GUILD_IDS` | Step 4 |
| 7 | `WORKER_NAME` | You choose it, e.g. `bounty-board-myguild` |

---

## Step 1: Fork the project on GitHub

1. Go to the Bounty Line repository on GitHub and click **Fork** (top right) → **Create fork**.
   You now have your own copy.
2. In **your fork**, open the **Actions** tab. GitHub turns workflows off in new forks: click
   **I understand my workflows, go ahead and enable them**.

## Step 2: Cloudflare account ID and API token

1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com) and click **Workers & Pages**
   in the left menu.
   - The first time, Cloudflare asks you to **pick a workers.dev subdomain** (e.g.
     `myguild`). Pick anything; your bot's address will be
     `https://<WORKER_NAME>.<subdomain>.workers.dev`.
2. On that page, copy the **Account ID** (right side; 32 letters and numbers). That's value
   **1**.
3. *(Optional but recommended)* **Workers & Pages → Plans → Workers Paid**. Without it, use
   budget mode (step 5).
4. *(Needed for kill screenshots)* **R2 Object Storage** in the left menu → enable it (there's
   a free tier; Cloudflare may ask for a card).
5. Create the API token: top right **profile icon → My Profile → API Tokens → Create Token**.
   - Find **Edit Cloudflare Workers** → **Use template**.
   - Under **Permissions**, make sure these rows exist (use **+ Add more** for missing ones):
     - Account · **Workers Scripts** · Edit
     - Account · **D1** · Edit
     - Account · **Workers R2 Storage** · Edit
     - Account · **Workers AI** · Read
   - **Account Resources:** Include · *your account*.
   - **Zone Resources:** if there's a zone row, delete it (the bot doesn't need a domain).
   - **Continue to summary → Create Token**, then **copy the token now** (Cloudflare shows it
     only once). That's value **2** 🔒.

## Step 3: Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) →
   **New Application** → name it (e.g. *Bounty Board*) → Create.
2. **General Information** page:
   - Copy **Application ID** → value **3**.
   - Copy **Public Key** → value **4**.
   - *(Optional)* upload an icon. Leave **Interactions Endpoint URL** empty; the Bootstrap
     sets it for you.
3. **Bot** page (left menu):
   - Click **Reset Token** → copy it → value **5** 🔒.
   - Turn **Public Bot** **OFF** (so only you can add it to servers).
   - Turn **Message Content Intent** **ON**, then **Save Changes**. (Skip only in budget mode.)

## Step 4: Your Discord server ID

1. In Discord: **User Settings → Advanced → Developer Mode: ON**.
2. Right-click your **server icon** → **Copy Server ID**. That's value **6** (a long number).

## Step 5: Put the values into your fork

In **your fork** on GitHub: **Settings → Secrets and variables → Actions**.

**Secrets** tab → **New repository secret**, once for each:

| Name | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | value 1 |
| `CLOUDFLARE_API_TOKEN` | value 2 🔒 |
| `DISCORD_APP_ID` | value 3 |
| `DISCORD_PUBLIC_KEY` | value 4 |
| `DISCORD_TOKEN` | value 5 🔒 |

**Variables** tab → **New repository variable**, once for each:

| Name | Value |
|---|---|
| `WORKER_NAME` | value 7, lowercase letters, numbers and dashes, e.g. `bounty-board-myguild` |
| `ALLOWED_GUILD_IDS` | value 6 |

**Budget mode** (Cloudflare Free plan): also add Variables `READ_CHAT` = `false`,
`AI_CHECK` = `false` and `POSTER_IMAGE` = `false`. Players then submit codes with `/bl submit`
instead of pasting in chat, officers approve every kill, and posters are text-only.

> Names must match exactly (capitals and underscores). A typo is the most common problem, and
> the dry run in the next step catches it.

## Step 6: Dry run (checks everything, changes nothing)

1. Your fork → **Actions** → **Bootstrap deployment** (left list) → **Run workflow**.
   Leave **Dry run** ticked → **Run workflow**.
2. Wait a minute, click the run, and scroll to its **summary**.
   - ❌ **Must fix**: each row says what's wrong and how to fix it. Fix, then run the dry run
     again.
   - ⚠️ **Worth fixing**: things like *Public Bot is on* or *Message Content Intent is off*.
   - ✅ **Everything checks out**: go on.

## Step 7: Deploy

1. **Actions → Bootstrap deployment → Run workflow**, **untick Dry run** → **Run workflow**.
2. It creates your database and screenshot storage, deploys the bot, stores its secrets, sets
   Discord's Interactions Endpoint URL, and checks the bot answers. About 2–3 minutes.
3. Open the run's **summary**. It ends with your **next steps**, including your bot's **invite
   link**.

## Step 8: Invite the bot and set up your server

Follow the summary's next steps:

1. Open the **invite link** → choose your server → **Authorize**.
2. **Actions → Deploy Worker → Run workflow** once, so the `/bl` commands appear in your
   server.
3. In Discord, create a text channel **#bounty-line** and a **Forum** channel
   **#bounty-board** (forum settings → *Default Layout*: **Gallery**).
4. Forum **#bounty-board** → **Edit Channel → Permissions** → add your bot's role → allow
   **Manage Channels** (only on this forum; it's for the status tags).
5. Run **`/bl setup`** and choose #bounty-line, #bounty-board, your officer role and your
   in-game guild name.
6. Tell your guild: install **Bounty Line** from CurseForge, copy the pinned **Bounty Pack**
   in #bounty-line, and type `/bl import` in game. 🎉

---

## Staying up to date

When this project gets updates, your fork shows **"This branch is X commits behind"**. Click
**Sync fork → Update branch**. The **Deploy Worker** workflow then updates your bot
automatically (database changes included). Check [CHANGELOG.md](../CHANGELOG.md) → *Deployer
notes* for anything you need to do by hand.

## Troubleshooting

| You see | Do this |
|---|---|
| The dry run lists a missing Secret or Variable | Check the name's spelling and that it's in the right tab (Secrets vs Variables) |
| *Cloudflare refused the API token* | Make a new token (step 2.5) and update `CLOUDFLARE_API_TOKEN` |
| *Add … D1 → Edit* (or R2, Workers Scripts) | Edit the token in Cloudflare → My Profile → API Tokens and add that permission |
| *R2 isn't turned on* | Cloudflare dashboard → R2 Object Storage → enable |
| *No workers.dev subdomain* | Cloudflare → Workers & Pages → pick a subdomain |
| *Discord rejected DISCORD_TOKEN* | Developer Portal → Bot → Reset Token → update the secret |
| *DISCORD_APP_ID isn't the app…* | Copy the token, Application ID and Public Key from the **same** app |
| **Deploy the bot** failed | Read the red lines in that step; usually a token permission. Free plan? Add the budget-mode variables |
| *Couldn't set the Interactions Endpoint URL* | Paste the URL the summary shows into Developer Portal → General Information → Interactions Endpoint URL → Save |
| `/bl` commands don't show up | Run **Deploy Worker** once after inviting the bot; restart Discord (Ctrl+R) |
| The bot doesn't react to pasted codes | Message Content Intent must be ON (step 3.3); or use `/bl submit` |
| `/bl setup` says it can't make forum tags | Give the bot **Manage Channels** on #bounty-board only (step 8.4), then run `/bl setup` again |

Still stuck? Open an issue on GitHub with the run's summary (it never contains your tokens).
