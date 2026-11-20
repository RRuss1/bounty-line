# Privacy

There is no central Bounty Line service. **Each guild runs its own Bounty Board bot** on its
own Cloudflare account, and that guild is responsible for the data its bot holds.

## The addon

The addon stores data only in your WoW SavedVariables on your computer: open bounties,
last-seen info and your recent kill codes. It makes no network requests. It shares bounty
data with guildmates over the in-game guild addon channel.

## A Bounty Board bot stores

- Discord user IDs of people who post or claim bounties
- WoW character names and GUIDs from the codes people paste
- Screenshots submitted as kill proof
- Bounty, kill, payment and leaderboard records for that Discord server

## Deleting your data

`/bl forget-me` in Discord deletes your character links and stats from that server's bot.
Screenshots in already-closed bounties are anonymized.
