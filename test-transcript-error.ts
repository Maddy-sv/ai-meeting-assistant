import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env', 'utf8')
const envUrl = envFile.match(/VITE_SUPABASE_URL="(.*)"/)?.[1]
const envKey = envFile.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*)"/)?.[1]

const supabase = createClient(envUrl, envKey)

async function run() {
  const { data: meetings } = await supabase.from('meetings').select('*').limit(1)
  if (meetings && meetings.length > 0) {
    const id = meetings[0].id
    const newSeg = {
      meeting_id: id,
      speaker: "Test Speaker",
      content: "Test content",
      segment_index: 1,
      spoken_at: new Date().toISOString()
    }
    const { data, error } = await supabase.from('transcripts').insert(newSeg).select()
    console.log("Insert result:", { data, error })
  }
}
run()
