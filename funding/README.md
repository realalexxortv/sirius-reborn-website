# Funding

A Cloudflare Worker with a D1 database. Ko-fi and Patreon tell it about each payment by webhook. It serves the goals and
the last 10 backers at `GET /funding`, which the site's Donate page and the bar above the news timeline read. The CMS's
Funding tab edits the goals, adds payments by hand (stream tips, Super Chats, transfers) and hides or voids a payment.
The endpoints are listed at the top of `src/index.js`.

## What counts and what shows

- **Ko-fi:** donations and memberships count, shop orders and commissions don't. The name is what the donor typed. If
  they ticked Ko-fi's "private" box, the payment counts and the name shows as *Anonymous*.
- **Patreon:** each charge counts. Patreon only sends a member's lifetime total, so a charge is how far that total rose
  since the last webhook. The name is the **first name** of the Patreon account, because account names are often real
  names.
- **By hand:** whatever the CMS's Funding tab adds.
- A goal counts the payments in **its currency** from its start date, or from the 1st of the current month for a monthly
  goal. Keep Ko-fi, Patreon and the goals in one currency (EUR). Payments in another currency are stored but not
  counted.
- The backer list shows each person once, at their latest payment, newest first. *Hide* takes a name off the list and
  the money still counts. *Void* (a refund or a test) neither counts nor shows. Ko-fi doesn't report refunds, so void
  those by hand.
- No backers yet: the site says so. No goals: no bar. `funding.api` empty in the site settings: none of it shows.

## Setting it up (once)

You need a free Cloudflare account. Run all of this in `funding/`.

1. `npm install`, then `npx wrangler login` (opens the browser).
2. `npx wrangler d1 create sirius-funding`, and copy the `database_id` it prints into `wrangler.toml`.
3. `npx wrangler d1 execute sirius-funding --remote --file schema.sql`
4. `npx wrangler deploy`. It prints the worker's URL, `https://sirius-funding.<you>.workers.dev`.
5. The admin token, a long random password that only you and the CMS know:
   `openssl rand -hex 24`, then `npx wrangler secret put ADMIN_TOKEN` and paste it.
6. **Ko-fi:** [ko-fi.com/manage/webhooks](https://ko-fi.com/manage/webhooks). Set the webhook URL to `<worker URL>/kofi`.
   Copy the *Verification Token* shown there into `npx wrangler secret put KOFI_TOKEN`. Click *Send Single Donation
   Test*: a payment named *Jo Example* appears in the CMS's Funding tab. Void it.
7. **Patreon:** [patreon.com/portal/registration/register-webhooks](https://www.patreon.com/portal/registration/register-webhooks).
   Add `<worker URL>/patreon` with the triggers `members:create`, `members:update`, `members:pledge:create` and
   `members:pledge:update`. Copy its secret into `npx wrangler secret put PATREON_SECRET`. If the campaign isn't in EUR,
   change `PATREON_CURRENCY` in `wrangler.toml` and deploy again.
8. CMS → Settings → *Funding worker URL*: the worker URL. CMS → Funding: paste the admin token and add the goals.

A change to `src/index.js` goes live with `npx wrangler deploy`. Merging to `main` only updates the site.

## Testing

`npm test` runs the worker locally on a throwaway database and checks the webhooks, the totals, the backer list and the
admin endpoints (`test/smoke.sh`).

The free plans are far above what this uses: 100,000 worker requests a day and 5 million D1 reads a day. The site's
calls to `/funding` are cached for 30 seconds.
