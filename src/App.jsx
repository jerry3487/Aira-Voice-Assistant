import { useEffect, useState } from 'react';
import { ClerkFailed, ClerkLoaded, ClerkLoading, Show, useAuth } from '@clerk/react';
import AuthScreen from './components/AuthScreen.jsx';
import TopBar from './components/TopBar.jsx';
import VoiceScreen from './components/VoiceScreen.jsx';
import ModelsScreen from './components/ModelsScreen.jsx';
import MemoryNotesScreen from './components/MemoryNotesScreen.jsx';
import { useVoiceAssistant } from './hooks/useVoiceAssistant.js';
import { setTokenProvider } from './utils/apiClient.js';

function AiraWorkspace({ theme, onToggleTheme }) {
  const [activeTab, setActiveTab] = useState('voice');
  const assistant = useVoiceAssistant();

  const handleNewChat = () => {
    assistant.startNewConversation();
    setActiveTab('voice');
  };

  return (
    <div className="min-h-screen bg-[#F5F4F0] text-slate-900 transition-colors dark:bg-[#0A0D12] dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onNewChat={handleNewChat}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <main>
        {activeTab === 'voice' && <VoiceScreen assistant={assistant} theme={theme} />}
        {activeTab === 'models' && <ModelsScreen assistant={assistant} />}
        {activeTab === 'memory' && (
          <MemoryNotesScreen
            assistant={assistant}
            onOpenVoice={() => setActiveTab('voice')}
          />
        )}
      </main>
    </div>
  );
}

function AuthenticatedGate({ theme, onToggleTheme }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [providerReady, setProviderReady] = useState(false);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setTokenProvider(() => getToken());
      setProviderReady(true);
    } else {
      setTokenProvider(null);
      setProviderReady(false);
    }
    return () => {
      setTokenProvider(null);
    };
  }, [isLoaded, isSignedIn, getToken]);

  if (!providerReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F4F0] text-slate-900 dark:bg-[#0A0D12] dark:text-slate-100">
        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
          Loading Aira...
        </p>
      </div>
    );
  }

  return <AiraWorkspace theme={theme} onToggleTheme={onToggleTheme} />;
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('localvox-theme') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('localvox-theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <>
      <ClerkLoading>
        <div className="flex min-h-screen items-center justify-center bg-[#F5F4F0] text-slate-900 dark:bg-[#0A0D12] dark:text-slate-100">
          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
            Loading Aira...
          </p>
        </div>
      </ClerkLoading>

      <ClerkFailed>
        <AuthScreen theme={theme} onToggleTheme={handleToggleTheme} />
      </ClerkFailed>

      <ClerkLoaded>
        <Show when="signed-out">
          <AuthScreen theme={theme} onToggleTheme={handleToggleTheme} />
        </Show>
        <Show when="signed-in">
          <AuthenticatedGate theme={theme} onToggleTheme={handleToggleTheme} />
        </Show>
      </ClerkLoaded>
    </>
  );
}
