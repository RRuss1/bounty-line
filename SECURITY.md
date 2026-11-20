# Security Policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's
**private vulnerability reporting** instead: the **Security** tab → **Report a vulnerability**.

Useful to include: what's affected (addon, bot, or the code format), steps to
reproduce, and the impact you expect.

## Scope

- The Bounty Board Worker (`worker/`): request verification, tenant isolation, secrets handling
- The code format and decoders (`shared/CODEC.md`)
- The addon (`addon/`)

## Known limits

Addon code is public by design, so a determined player can forge a code. The bot defends
against this with screenshot checks, officer review and trust levels, not secrecy. See
design spec Section 13.
