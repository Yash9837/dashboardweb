import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Command Center features will not work until these are configured.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Fetch ALL rows from a Supabase table, paginating past the 1,000-row default limit.
 * 
 * Usage:
 *   const events = await fetchAllRows('financial_events', 'id, amount, event_type', q => q.eq('event_type', 'shipment'));
 */
export async function fetchAllRows<T = any>(
  table: string,
  select: string = '*',
  filterFn?: (query: any) => any,
  orderCol?: string,
  orderAsc: boolean = true,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase.from(table).select(select);
    if (filterFn) query = filterFn(query);
    if (orderCol) query = query.order(orderCol, { ascending: orderAsc });
    query = query.range(offset, offset + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) {
      console.error(`[fetchAllRows] ${table} offset=${offset}: ${error.message}`);
      throw error;
    }
    if (!data || data.length === 0) break;
    allRows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  return allRows;
}
