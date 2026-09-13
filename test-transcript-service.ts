import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env', 'utf8')
const envUrl = envFile.match(/VITE_SUPABASE_URL="(.*)"/)?.[1]
const envKey = envFile.match(/SUPABASE_PUBLISHABLE_KEY="(.*)"/)?.[1] 

// We need the SERVICE_ROLE_KEY to bypass RLS!
// The .env has VITE_SUPABASE_PUBLISHABLE_KEY. Does it have service role key?
// Let's check .env for service role key.
