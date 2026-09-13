import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env', 'utf8')
const envUrl = envFile.match(/VITE_SUPABASE_URL="(.*)"/)?.[1]
const envKey = envFile.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*)"/)?.[1]

const supabase = createClient(envUrl, envKey)

async function run() {
  const { data: transcripts, error } = await supabase.from('transcripts').select('*')
  if (error) console.error("Err:", error)
  console.log("Transcripts total count:", transcripts?.length)
}
run()
