-- Schedule the send-reminders edge function every 15 minutes.
--
-- This is NOT a migration. Run it once, by hand, in the Supabase SQL editor of
-- the project that hosts this app, after:
--   1. Enabling the extensions "pg_cron" and "pg_net"
--      (Dashboard -> Database -> Extensions).
--   2. Deploying the function:  supabase functions deploy send-reminders --no-verify-jwt
--   3. Setting the function secret (choose a long random value):
--        supabase secrets set REMINDERS_CRON_SECRET=<random value>
--   4. Storing the project URL and the SAME secret in Vault (replace the
--      placeholders; do not commit real values):
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--        select vault.create_secret('<same random value>', 'reminders_cron_secret');
--
-- To change the schedule later, run this file again (it replaces the job).
-- To stop reminders:  select cron.unschedule('send-meeting-reminders');

select cron.unschedule(jobid)
from cron.job
where jobname = 'send-meeting-reminders';

select cron.schedule(
  'send-meeting-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
