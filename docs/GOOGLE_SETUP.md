# Turning on Google sign-in and Google Calendar import

Google is **off by default**. While it is off:

- the sign-in page has no "Continue with Google" button;
- the Calendar page has no Google Calendar card;
- the Profile page has no "Connected accounts" card.

Email/password sign-in and everything else work without it.

Follow these steps when you want Google back on. It takes about 15 minutes.

## 1. Create a Google OAuth client

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project (or pick an existing one).
2. **APIs & Services → OAuth consent screen**:
   - choose **External**;
   - fill in the app name, support email and developer email;
   - under **Scopes**, add `openid`, `email`, `profile` and `https://www.googleapis.com/auth/calendar.readonly`;
   - while the app is in **Testing** mode, add every Google account that should be able to sign in under **Test users**.
3. **APIs & Services → Library** → search **Google Calendar API** → **Enable**. This is only needed for calendar import.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - application type: **Web application**;
   - **Authorised JavaScript origins:** your app URL (e.g. `https://your-app.lovable.app`) and `http://localhost:8080`;
   - **Authorised redirect URIs:** the **Callback URL** shown on the Supabase Google provider page (step 2). It looks like `https://<project-ref>.supabase.co/auth/v1/callback`.
5. Copy the **Client ID** and **Client secret**.

## 2. Enable Google in Supabase

In the Supabase dashboard, open your project:

1. **Authentication → Sign In / Providers → Google**: enable it and paste the Client ID and Client secret. Save.
2. **Authentication → Sign In / Providers → User Signups**: turn on **Allow manual linking**. This lets an email/password user connect Google later, from Calendar or Profile.
3. **Authentication → URL Configuration**: make sure the **Redirect URLs** include `YOUR-APP-URL/**` and `http://localhost:8080/**`.

## 3. Switch it on in the app

Set this environment variable, then rebuild or redeploy:

```
VITE_ENABLE_GOOGLE=true
```

- **Locally:** add it to `.env` and restart `npm run dev`.
- **Hosted (Lovable):** add it to the project's environment variables, then publish again.

## 4. Check it works

1. **Sign-in page:** "Continue with Google" appears, and signing in brings you back into the app.
2. **Calendar:** "Connect Google Calendar" then "Import from Google" adds your upcoming events. Importing again skips events already imported.
3. **Profile:** "Connected accounts" shows Google as connected.

## Notes

- Google only shares calendar access for a short time after you sign in. When it expires, the Calendar page shows **"Reconnect Google to import"**; this is expected.
- In **Testing** mode only listed test users can sign in. To open it to everyone, publish the consent screen. Google may ask for verification because of the calendar scope.
- The code involved:
  - `src/lib/features.ts` (the switch);
  - `src/routes/auth.tsx` (`GoogleButton`);
  - `src/routes/_authenticated/calendar.tsx` (import);
  - `src/routes/_authenticated/profile.tsx` (`ConnectedAccounts`).
