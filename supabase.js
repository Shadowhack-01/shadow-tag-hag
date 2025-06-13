import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Replace with your actual Supabase project URL and anon key
const supabaseUrl = "https://jhrdlhnaneblcaucetbp.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocmRsaG5hbmVibGNhdWNldGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4NjgyNjcsImV4cCI6MjA2MzQ0NDI2N30.43EWIXMnOn9Ckd7tk5nZuAqIK5OYHyC2nJiyudsobhQ";

export const supabase = createClient(supabaseUrl, supabaseKey);