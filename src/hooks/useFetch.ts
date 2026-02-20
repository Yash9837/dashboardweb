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

    const buildRequestUrl = useCallback((force: boolean) => {
        if (!force) return url;
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}refresh=true&_ts=${Date.now()}`;
    }, [url]);

    const fetchData = useCallback(async (force = false) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(buildRequestUrl(force), { cache: 'no-store' });
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
    }, [buildRequestUrl]);

    useEffect(() => {
        void fetchData(false);
    }, [fetchData, ...deps]);

    const refresh = useCallback(async () => {
        await fetchData(true);
    }, [fetchData]);

    return { data, loading, error, refresh };
}
