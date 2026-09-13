import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  try {
    // 1. Calculate tomorrow's date range
    const today = new Date()
    const tomorrowStart = new Date(today)
    tomorrowStart.setDate(tomorrowStart.getDate() + 1)
    tomorrowStart.setHours(0, 0, 0, 0)
    
    const tomorrowEnd = new Date(today)
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1)
    tomorrowEnd.setHours(23, 59, 59, 999)

    // 2. Fetch meetings scheduled for tomorrow
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select('*')
      .gte('scheduled_at', tomorrowStart.toISOString())
      .lte('scheduled_at', tomorrowEnd.toISOString())
      .neq('status', 'completed')

    if (meetingsError) throw meetingsError

    if (!meetings || meetings.length === 0) {
      return new Response(JSON.stringify({ message: "No meetings scheduled for tomorrow." }), { headers: { "Content-Type": "application/json" } })
    }

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set in Edge Function secrets. Please configure it in your Supabase Dashboard.")
    }

    let sentCount = 0;

    // 3. Send email for each meeting
    for (const meeting of meetings) {
      // Get the host's email using the Supabase Admin API
      const { data: userAuth, error: authError } = await supabase.auth.admin.getUserById(meeting.host_id)
      
      const email = userAuth?.user?.email;
      if (!email) {
        console.warn(`No email found for host_id ${meeting.host_id}`);
        continue;
      }

      const time = new Date(meeting.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const platform = meeting.platform.replace("_", " ")

      // Send via Resend API
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'AI Meeting Companion <onboarding@resend.dev>',
          to: email,
          subject: `Reminder: ${meeting.title} is tomorrow!`,
          html: `
            <h2>Meeting Reminder</h2>
            <p>Hi there,</p>
            <p>This is a reminder that you have a meeting scheduled for tomorrow.</p>
            <ul>
              <li><strong>Title:</strong> ${meeting.title}</li>
              <li><strong>Time:</strong> ${time}</li>
              <li><strong>Platform:</strong> ${platform}</li>
            </ul>
            ${meeting.meeting_link ? `<p><a href="${meeting.meeting_link}">Join Meeting</a></p>` : ''}
            <p>Best regards,<br>AI Powered Meeting Companion</p>
          `
        })
      })

      if (res.ok) {
        sentCount++;
      } else {
        console.error("Failed to send email to", email, await res.text());
      }
    }

    return new Response(
      JSON.stringify({ message: `Successfully sent ${sentCount} reminders.` }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})
