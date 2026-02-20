'use client';
import { useState, useEffect, useCallback } from 'react';

interface UseFetchResult<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

/**
 * Custom hook for data fetching with loading/error state management.
 * Reduces the identical useState+useEffect+fetch pattern across all pages.
 */
export function useFetch<T = any>(url: string, deps: any[] = []): UseFetchResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`API returned ${res.status}`);
            const json = await res.json();
            if (json.error && !json.kpis && !json.orders && !json.items) {
                throw new Error(json.error);
            }
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [url]);

    useEffect(() => {
        fetchData();
    }, [fetchData, ...deps]);

    return { data, loading, error, refresh: fetchData };
}
