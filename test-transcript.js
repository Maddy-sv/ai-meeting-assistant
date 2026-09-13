import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env', 'utf8')
const envUrl = envFile.match(/VITE_SUPABASE_URL="(.*)"/)?.[1]
const envKey = envFile.match(/VITE_SUPABASE_PUBLISHABLE_KEY="(.*)"/)?.[1]

const supabase = createClient(envUrl, envKey)

async function run() {
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  // Wait, we need to sign in to satisfy RLS! But we don't have user password.
  // We can just try to insert without auth to see if it's RLS.
  
  // Actually, we can just login with email/password if we know it.
  console.log("URL:", envUrl)
}
run()
