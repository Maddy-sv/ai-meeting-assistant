import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env', 'utf8')
const envUrl = envFile.match(/VITE_SUPABASE_URL="(.*)"/)?.[1]
const envKey = envFile.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*)"/)?.[1]

const supabase = createClient(envUrl, envKey)

async function run() {
  const email = `test_${Date.now()}@example.com`
  const password = 'Password123!'
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password })
  if (signUpErr) { console.error("Sign up err:", signUpErr); return; }
  
  const { data: meeting, error: meetErr } = await supabase.from('meetings').insert({
    title: 'Test Meeting',
    host_id: signUpData.user.id
  }).select().single()
  
  if (meetErr) { console.error("Meet err:", meetErr); return; }
  console.log("Meeting created:", meeting.id)

  const newSeg = {
    meeting_id: meeting.id,
    speaker: "Test Speaker",
    content: "Test content",
    segment_index: 1,
    spoken_at: new Date().toISOString()
  }
  const { data, error } = await supabase.from('transcripts').insert(newSeg).select()
  console.log("Insert result:", { data, error })
}
run()
