import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env', 'utf8')
const envUrl = envFile.match(/VITE_SUPABASE_URL=(.*)/)?.[1]
const envKey = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)?.[1]

const supabase = createClient(envUrl!, envKey!)

async function test() {
  const { data: { user } } = await supabase.auth.getUser()
  console.log("User:", user)
}
test()
