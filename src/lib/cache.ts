/**
 * File-based JSON cache for SP-API data.
 * Persists data to .cache/ directory so it survives server restarts
 * and avoids hitting SP-API rate limits on every page load.
 */

import fs from 'fs';
import path from 'path';

const CACHE_DIR = process.env.CACHE_DIR
    || (process.env.VERCEL ? '/tmp/smartcommerce-cache' : path.join(process.cwd(), '.cache'));
const memoryCache = new Map<string, CacheEntry<unknown>>();

// Ensure cache directory exists
function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

function getCachePath(key: string): string {
    // Sanitize key for filesystem
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(CACHE_DIR, `${safeKey}.json`);
}

/**
 * Get cached data. Returns null if expired or not found.
 */
export function getCached<T>(key: string): T | null {
    try {
        const filePath = getCachePath(key);
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const entry: CacheEntry<T> = JSON.parse(raw);

            const age = Date.now() - entry.timestamp;
            if (age > entry.ttl) {
                return null;
            }

            return entry.data;
        }
    } catch {
        // Fall through to in-memory cache fallback.
    }

    const memoryEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
    if (!memoryEntry) return null;

    const memoryAge = Date.now() - memoryEntry.timestamp;
    if (memoryAge > memoryEntry.ttl) return null;

    return memoryEntry.data;
}

function getMemoryStale<T>(key: string): T | null {
    const memoryEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
    return memoryEntry ? memoryEntry.data : null;
}

function setMemoryCache<T>(key: string, data: T, ttlMs: number): void {
    memoryCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl: ttlMs,
    });
}

function clearMemoryCache(): void {
    memoryCache.clear();
}

function removeMemoryKey(key: string): void {
    memoryCache.delete(key);
}

function getCacheEntryFromFile<T>(key: string): CacheEntry<T> | null {
    try {
        const filePath = getCachePath(key);
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as CacheEntry<T>;
    } catch {
        return null;
    }
}

/**
 * Get cached data, even if expired (for fallback).
 */
export function getStale<T>(key: string): T | null {
    const fromFile = getCacheEntryFromFile<T>(key);
    if (fromFile) return fromFile.data;
    return getMemoryStale<T>(key);
}

/**
 * Save data to cache with a TTL in milliseconds.
 */
export function setCache<T>(key: string, data: T, ttlMs: number): void {
    setMemoryCache(key, data, ttlMs);

    try {
        ensureCacheDir();
        const filePath = getCachePath(key);
        const entry: CacheEntry<T> = {
            data,
            timestamp: Date.now(),
            ttl: ttlMs,
        };
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
    } catch (err) {
        console.error(`[Cache] Failed to write ${key}:`, err);
    }
}

/**
 * Merge new data into existing cached data (for incremental catalog updates).
 * Useful when some catalog lookups succeed and others fail — we keep the successful ones.
 */
export function mergeCache<T extends Record<string, any>>(key: string, newData: Partial<T>, ttlMs: number): void {
    const existing = getStale<T>(key) || {} as T;
    const merged = { ...existing, ...newData };
    setCache(key, merged, ttlMs);
}

/**
 * Clear all cached data.
 */
export function clearCache(): void {
    clearMemoryCache();

    try {
        if (fs.existsSync(CACHE_DIR)) {
            const files = fs.readdirSync(CACHE_DIR);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    removeMemoryKey(file.replace(/\.json$/, ''));
                    fs.unlinkSync(path.join(CACHE_DIR, file));
                }
            }
        }
    } catch (err) {
        console.error('[Cache] Failed to clear:', err);
    }
}

// TTL constants
export const TTL = {
    DASHBOARD: 5 * 60 * 1000,          // 5 minutes
    ORDERS: 5 * 60 * 1000,             // 5 minutes
    CATALOG: 7 * 24 * 60 * 60 * 1000,  // 7 days (product info rarely changes)
    ORDER_ITEMS: 24 * 60 * 60 * 1000,  // 24 hours
    INVENTORY: 10 * 60 * 1000,         // 10 minutes
} as const;
