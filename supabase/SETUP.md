# Supabase pilot: setup

The Brain can read and write a Supabase database instead of the Google Sheet. **The Sheet stays the default** until you switch over; the Supabase copy is for trying out. The Sheet is only ever read by the copy, never changed.

Project: `jcm-apps` (Sydney), `https://apeflgdzclpxiktaxyfk.supabase.co`. Tables live in the `brain` schema.

You never need the `service_role` key or the database password for any of this. Don't paste either one into a chat. The Google **client secret** in step 3 goes straight into Supabase, never into a chat either.

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

## 3. Make a Google sign-in client for Supabase (Google Cloud, 5 minutes)

A separate client keeps the book library's sign-in untouched.

1. Open https://console.cloud.google.com and sign in as the Google account that owns the book library's sign-in. Check the project picker (top left) shows the same project.
2. Left menu: **APIs & Services → Credentials** (newer screens call it **Google Auth Platform → Clients**).
3. Click **+ Create credentials → OAuth client ID** (or **+ Create client**).
4. Application type: **Web application**. Name: `Supabase sign-in`.
5. Under **Authorized JavaScript origins**, click **+ Add URI** and enter `https://jcm-book-library.github.io`
6. Under **Authorized redirect URIs**, click **+ Add URI** and enter exactly:
   `https://apeflgdzclpxiktaxyfk.supabase.co/auth/v1/callback`
7. Click **Create**. A box shows the **Client ID** and **Client secret**. Keep this tab open for step 4. (Google only shows the secret once. If you lose it, open the client and click **Add secret**.)

If your Google sign-in screen is in **Testing** mode, your own Google account must be listed under **Audience → Test users**. It already is if the book library's sign-in works for you.

## 4. Turn on Google sign-in in Supabase (Supabase, 2 minutes)

1. Left sidebar: **Authentication**.
2. Click **Sign In / Providers**, then **Google** in the list.
3. Switch **Enable Sign in with Google** on.
4. Paste the **Client ID** into **Client IDs** and the **Client secret** into **Client Secret (for OAuth)**. Leave the other options as they are.
5. Click **Save**.
6. Still in **Authentication**, click **URL Configuration**.
7. **Site URL**: `https://jcm-book-library.github.io/the-brain/` then **Save**.
8. **Redirect URLs**: click **Add URL**, enter `https://jcm-book-library.github.io/the-brain/**`, click **Save URLs**.

## 5. Merge the pull request

Merging adds the Supabase options to Settings. Nothing changes day to day: the page still uses the Sheet until you pick Supabase.

## 6. Sign in and copy (on the live page, 2 minutes)

1. Open https://jcm-book-library.github.io/the-brain/ and make sure it's connected to Google as usual.
2. Click **Settings**, then **Sign in to Supabase**. Pick your Google account. You come back to the page with Settings open, saying "Signed in to Supabase as …".
3. Click **Copy Sheet → Supabase**, then click it again when it says **Replace Supabase copy?**.
4. Wait for "Copied N rows and checked them: Supabase matches your Sheet." The copy reads your Sheet, writes Supabase, then reads Supabase back and compares every row.

You can run the copy again any time before switch-over to refresh the Supabase copy. It replaces whatever is in Supabase, so anything you added while trying Supabase mode is replaced by the Sheet's version.

## 7. Lock the door (Supabase, 1 minute)

Do this straight after your first sign-in, so no one else can create an account.

1. **Authentication → Users**: check you are the only user listed.
2. **Authentication → Sign In / Providers**: at the top, switch **Allow new users to sign up** off, then **Save**.
3. Optional: in the same list, open **Email** and switch it off (you sign in with Google only).

Even without this, other accounts couldn't see your data: Row Level Security only shows each signed-in person their own rows, and signed-out visitors get nothing. Turning sign-ups off just keeps strangers out entirely.

## 8. Try it

- **Settings → Where your data lives → Supabase (pilot) → Save & connect.** The status shows "Supabase · <time>".
- Switch back to **Google Sheet** the same way at any time. Each device remembers its own choice.
- You stay signed in to Supabase on each device until you click **Sign out of Supabase** in Settings.

Optional check: SQL Editor → New query → paste [`02-check.sql`](02-check.sql) → Run. It lists each table's row count and confirms RLS is on.

## Good to know

- Free projects pause after 7 days with no use. Opening The Brain in Supabase mode counts as use. A paused project can be restored from the dashboard with one click (Restore project); no data is lost.
- Switch-over (later, when you say): the page would default to Supabase, the copy button goes away, and the Sheet tabs get a "Moved to Supabase on <date>" note. Not done yet.
