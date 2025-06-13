
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Replace with your actual values:
const SUPABASE_URL = "https://jhrdlhnaneblcaucetbp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocmRsaG5hbmVibGNhdWNldGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4NjgyNjcsImV4cCI6MjA2MzQ0NDI2N30.43EWIXMnOn9Ckd7tk5nZuAqIK5OYHyC2nJiyudsobhQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY,  {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
})