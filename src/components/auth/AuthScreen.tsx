'use client';

import { FormEvent, useState } from 'react';
import { Loader2, LogIn, Mail, KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

function readableError(message: string): string {
    return message
        .replace('Firebase: ', '')
        .replace(/\(auth\/([^)]+)\)\.?/g, '$1')
        .replace(/-/g, ' ')
        .trim();
}

export default function AuthScreen() {
    const { signInWithEmail, signInWithGoogle } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [googleSubmitting, setGoogleSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleEmailSignIn = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            await signInWithEmail(email, password);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Unable to sign in. Please try again.';
            setError(readableError(message));
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError(null);
        setGoogleSubmitting(true);

        try {
            await signInWithGoogle();
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Google sign-in failed. Please try again.';
            setError(readableError(message));
        } finally {
            setGoogleSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#080b14] flex items-center justify-center px-4">
            <div className="w-full max-w-md bg-[#111827]/80 border border-white/10 rounded-2xl p-6 shadow-2xl">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-white tracking-tight">Sign in to SmartCommerce</h1>
                    <p className="text-sm text-slate-400 mt-1">Use your Firebase account to access the dashboard.</p>
                </div>

                <form onSubmit={handleEmailSignIn} className="space-y-4">
                    <label className="block">
                        <span className="text-xs text-slate-400 mb-1.5 block">Email</span>
                        <div className="relative">
                            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400/50"
                                placeholder="you@example.com"
                            />
                        </div>
                    </label>

                    <label className="block">
                        <span className="text-xs text-slate-400 mb-1.5 block">Password</span>
                        <div className="relative">
                            <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400/50"
                                placeholder="••••••••"
                            />
                        </div>
                    </label>

                    <button
                        type="submit"
                        disabled={submitting || googleSubmitting}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                    >
                        {submitting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                        {submitting ? 'Signing in...' : 'Sign in with Email'}
                    </button>
                </form>

                <div className="my-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-xs text-slate-500">OR</span>
                    <div className="h-px flex-1 bg-white/10" />
                </div>

                <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={submitting || googleSubmitting}
                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 text-slate-300 hover:border-white/20 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
                >
                    {googleSubmitting ? 'Opening Google...' : 'Continue with Google'}
                </button>

                {error && (
                    <p className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                        {error}
                    </p>
                )}
            </div>
        </div>
    );
}
