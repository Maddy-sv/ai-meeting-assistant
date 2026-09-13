import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  // CORS for frontend invocation
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Expose-Headers': 'Content-Length, X-JSON',
      'Access-Control-Allow-Headers': 'apikey,X-Client-Info, Content-Type, Authorization, Accept, Accept-Language, X-Authorization'
    }});
  }

  try {
    const { email, title, time, platform, link } = await req.json();

    if (!email) throw new Error("Email is required");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "Meeting Companion <onboarding@resend.dev>",
        to: email,
        subject: `Meeting Scheduled: ${title}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #000;">Your meeting is scheduled! 🎉</h2>
            <p>You have successfully scheduled <strong>${title}</strong>.</p>
            <div style="background-color: #f4f4f5; padding: 20px; border-radius: 10px; margin: 20px 0;">
              <ul style="list-style: none; padding: 0; margin: 0; line-height: 2;">
                <li><strong>📅 Date & Time:</strong> ${new Date(time).toLocaleString()}</li>
                <li><strong>🎥 Platform:</strong> ${platform.replace("_", " ")}</li>
                ${link ? `<li><strong>🔗 Link:</strong> <a href="${link}">${link}</a></li>` : ""}
              </ul>
            </div>
            <p>Your AI Companion will automatically join and summarize this meeting for you. See you then!</p>
          </div>
        `
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Resend error:", errorText);
      throw new Error(`Failed to send email: ${errorText}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 400,
    });
  }
})
