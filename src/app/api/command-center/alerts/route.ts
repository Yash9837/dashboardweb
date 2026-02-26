import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        const { data: alerts, error } = await supabase
            .from('alerts')
            .select('*')
            .in('alert_status', ['active', 'acknowledged'])
            .order('created_at', { ascending: false })
            .limit(25);

        if (error) throw error;

        return NextResponse.json({ alerts: alerts || [] });
    } catch (err: any) {
        console.error('[Alerts]', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
