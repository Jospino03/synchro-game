import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://xobrwxwwvknzfaqayzic.supabase.co";
const supabaseKey = "sb_publishable_ROKnyI2-Bl4lvJESk4lb8Q_vA9l8XTU";

export const supabase = createClient(
    supabaseUrl,
    supabaseKey
);