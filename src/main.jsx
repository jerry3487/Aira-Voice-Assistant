import { ClerkProvider } from '@clerk/react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

createRoot(document.getElementById('root')).render(
  PUBLISHABLE_KEY ? (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  ) : (
    <div className="flex min-h-screen items-center justify-center bg-[#0A0D12] p-6 text-slate-100">
      <div className="max-w-md rounded-xl border border-red-500/40 bg-[#111620] p-6 text-sm">
        <p className="font-semibold text-red-300">Clerk Publishable Key Missing</p>
        <p className="mt-2 text-xs text-slate-400">
          Set <code className="text-sky-300">VITE_CLERK_PUBLISHABLE_KEY</code> in your environment and restart the server.
        </p>
      </div>
    </div>
  )
);
