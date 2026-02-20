'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
    GoogleAuthProvider,
    User,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
} from 'firebase/auth';
import { auth, initializeFirebaseAnalytics } from '@/lib/firebase';

interface AuthContextValue {
    user: User | null;
    loading: boolean;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signInWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const googleProvider = new GoogleAuthProvider();

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        initializeFirebaseAnalytics();
        const unsubscribe = onAuthStateChanged(auth, (nextUser: User | null) => {
            setUser(nextUser);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        user,
        loading,
        signInWithEmail: async (email: string, password: string) => {
            await signInWithEmailAndPassword(auth, email, password);
        },
        signInWithGoogle: async () => {
            await signInWithPopup(auth, googleProvider);
        },
        logout: async () => {
            await signOut(auth);
        },
    }), [user, loading]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
