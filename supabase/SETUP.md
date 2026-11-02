# Supabase pilot: setup

The Brain can read and write a Supabase database instead of the Google Sheet. **The Sheet stays the default** until you switch over; the Supabase copy is for trying out. The Sheet is only ever read by the copy, never changed.

Project: `jcm-apps` (Sydney), `https://apeflgdzclpxiktaxyfk.supabase.co`. Tables live in the `brain` schema.

You never need the `service_role` key or the database password for any of this. Don't paste either one into a chat. If you later add Google sign-in, its **client secret** goes straight into Supabase, never into a chat either.

## First: is the project paused?

Free Supabase projects pause after about a week without use. If the dashboard shows **jcm-apps** as paused (or The Brain says it can't reach Supabase), restore it before anything else:

1. Open https://supabase.com/dashboard and click **jcm-apps**.
2. Click the green **Restore project** button, then wait a few minutes until the project opens.
3. Your tables, users and settings come back as they were. Check with **Settings → Check Sheet and Supabase match** in The Brain. You may need to sign in again on each device (the email link, or your email and password).
4. If there is no restore button and the dashboard says the project can't be restored, stop and ask Claude. The Sheet still has everything.

Using The Brain in Supabase mode counts as use, so once you've switched over this stops happening.

## 1. Create the tables (Supabase, 2 minutes)

1. Open https://supabase.com/dashboard and click the **jcm-apps** project.
2. Left sidebar: **SQL Editor**.
3. Click **+ New query** (top left).
4. Open [`01-schema.sql`](01-schema.sql) on GitHub, click the **Copy raw file** button (two squares, top right of the file), and paste it into the editor.
5. Click **Run** (bottom right). You should see "Success. No rows returned".
   - A **Potential issues detected** box will appear (destructive operations, tables without RLS). Click **Run and enable RLS** (green). Both warnings are false alarms: the script turns RLS on in a loop the checker can't read, and the "destructive" part only resets access rules on brand-new, empty tables.

## 2. Let the app reach the `brain` tables (Supabase, 1 minute)

Your project has auto-expose off, so the new schema has to be added by hand.

1. Open the **Data API** page: **Integrations → Data API** in the left sidebar (older screens: **Project Settings → Data API**).
2. Leave **Enable Data API** on, and click the **Settings** tab at the top.
3. Find **Exposed schemas**. Click the box and choose **brain**, so it shows next to `public`. (If `brain` isn't listed, step 1 hasn't run yet.)
4. Click **Save**.

If you can't find it, press **Ctrl+K** (Cmd+K on a Mac) in the dashboard and type `Exposed schemas`.

## 3. Point sign-in links at The Brain (Supabase, 1 minute)

1. Left sidebar: **Authentication**, then **URL Configuration**.
2. **Site URL**: `https://jcm-book-library.github.io/the-brain/` then **Save**.
3. **Redirect URLs**: click **Add URL**, enter `https://jcm-book-library.github.io/the-brain/**`, click **Save URLs**.
4. Check email sign-in is on: **Authentication → Sign In / Providers → Email** should be enabled (it is by default). Leave its settings as they are.

(Supabase's built-in email can't be edited unless you connect your own email service, so the email carries a link only. That's why phones sign in with a password: see step 5.)

## 4. Merge the pull request

Merging adds the Supabase options to Settings. Nothing changes day to day: the page still uses the Sheet until you pick Supabase.

## 5. Sign in and copy (on the live page, 3 minutes)

1. Open https://jcm-book-library.github.io/the-brain/ and make sure it's connected to Google as usual.
2. Click **Settings**. In the Supabase box, type your email and click **Email me a sign-in link**.
3. Open the email from Supabase **on the same device and browser** and click the link. You come back to the page with Settings open, saying "Signed in to Supabase as …".
4. Click **Copy Sheet → Supabase**, then click it again when it says **Replace Supabase copy?**.
5. Wait for "Copied N rows and checked them: Supabase matches your Sheet." The copy reads your Sheet, writes Supabase, then reads Supabase back and compares every row.

Your laptop needs the email link once; your phone signs in with a password (see below). After that each device stays signed in. Supabase's built-in email sends only a few emails an hour, so if one doesn't arrive, wait rather than pressing the button repeatedly.

While **Where your data lives** is set to Google Sheet, this button copies Sheet → Supabase and replaces whatever is in Supabase. Once you switch to Supabase it turns round (see step 7), so it can never overwrite the source you're working in.

### Sign in on your phone: set a password

A phone's home-screen app keeps its own storage, separate from Safari, so an emailed link signs in the wrong place. A password works inside the app.

1. On the laptop, signed in to Supabase: **Settings → New password → Set password**. Use 12 or more characters: a few random words strung together is easy to remember and hard to guess. Keep it in a password manager. The Brain never stores it.
2. On the phone: **Settings**, type your email, type the password, **Sign in with password**. Then choose **Supabase** under *Where your data lives* and **Save & connect**.
3. After that you stay signed in on that device until you press **Sign out of Supabase**.

Supabase limits repeated wrong guesses, but a long password is what protects your data.

### Check where things stand

Any time you're unsure, open **Settings** (signed in to Supabase and Google) and click **Check Sheet and Supabase match**. It only reads. It lists every tab with its row count in each place, and says in plain words what differs ("3 only in the Sheet", "2 cells differ"). If you've been working in the Sheet, copy Sheet → Supabase; if you've been working in Supabase, copy Supabase → Sheet.

## 6. Lock the door (Supabase, 1 minute)

Do this straight after your first sign-in, so no one else can create an account.

1. **Authentication → Users**: check you are the only user listed.
2. **Authentication → Sign In / Providers**: at the top, switch **Allow new users to sign up** off, then **Save**. (Keep the **Email** provider on: that's how you sign in.)

Even without this, other accounts couldn't see your data: Row Level Security only shows each signed-in person their own rows, and signed-out visitors get nothing. Turning sign-ups off just keeps strangers out entirely.

## 7. Try it

- **Settings → Where your data lives → Supabase (pilot) → Save & connect.** The status shows "Supabase · <time>".
- Settings, Routine, Goals and Links are edited on the **Setup** tab (in either mode), so you don't need the Sheet or the Supabase dashboard for them.
- Each device remembers its own choice.

### Backing up to the Sheet, and going back

In Supabase mode the copy button reads **Copy Supabase → Sheet**. Use it weekly as a backup, and before going back to the Sheet:

1. **Settings → Copy Supabase → Sheet.** It lists what will change in each tab (cells changed, rows added, rows removed) and writes nothing yet.
2. Click **Write these to the Sheet**. It first makes a hidden backup of each tab it will change (e.g. `Plan backup 2026-10-21`, newest 3 kept per tab), then writes only the cells that differ, then reads the Sheet back and checks it matches Supabase.
3. To go back: set **Where your data lives** to **Google Sheet** and **Save & connect**. Nothing is missing.

To see the hidden backups: in the Sheet, **View → Hidden sheets**, or the ☰ list of tabs at the bottom left.
- You stay signed in to Supabase on each device until you click **Sign out of Supabase** in Settings.

Optional check: SQL Editor → New query → paste [`02-check.sql`](02-check.sql) → Run. It lists each table's row count and confirms RLS is on.

## Later, optional: add Google sign-in

Needs Google Cloud, which asks you to verify on your tablet. Sign-in with Google then works beside email and finds the same account, as long as it's the same email address.

**In Google Cloud (5 minutes)**

1. Open https://console.cloud.google.com, signed in as the account that owns the book library's sign-in. Check the project picker (top left) shows the same project.
2. Left menu: **APIs & Services → Credentials** (newer screens: **Google Auth Platform → Clients**).
3. Click **+ Create credentials → OAuth client ID** (or **+ Create client**).
4. Application type: **Web application**. Name: `Supabase sign-in`.
5. **Authorized JavaScript origins**: **+ Add URI**, `https://jcm-book-library.github.io`
6. **Authorized redirect URIs**: **+ Add URI**, exactly `https://apeflgdzclpxiktaxyfk.supabase.co/auth/v1/callback`
7. Click **Create**. Keep the box with the **Client ID** and **Client secret** open. (Google shows the secret once; if lost, open the client and click **Add secret**.)

If the Google sign-in screen is in **Testing** mode, your account must be under **Audience → Test users**. It already is if the book library's sign-in works.

**In Supabase (2 minutes)**

1. **Authentication → Sign In / Providers → Google**, switch **Enable Sign in with Google** on.
2. Paste the **Client ID** into **Client IDs** and the **Client secret** into **Client Secret (for OAuth)**. Click **Save**.
3. Then in The Brain's Settings, **Sign in with Google** works too.

Tip while you're in Google: add a backup way to verify (myaccount.google.com → **Security** → recovery phone or **backup codes**) so a missing tablet doesn't lock you out again.

## Good to know

- Free projects pause after about a week with no use. Opening The Brain in Supabase mode counts as use. See **First: is the project paused?** at the top for how to restore one.
- Switch-over (later, when you say): the page would default to Supabase, the copy button goes away, and the Sheet tabs get a "Moved to Supabase on <date>" note. Not done yet.
