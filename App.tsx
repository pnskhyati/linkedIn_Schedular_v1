
import React, { useState, useEffect } from 'react';
import {
  WorkflowStep,
  WorkflowData,
  PostInput,
  GeneratedPost,
  ContentPreferences,
  LinkedInUser
} from './types';
import { Header, StepIndicator } from './components/Layout';
import { generatePostsText, generatePostImage } from './geminiService';
import { saveHistory, getHistory } from './dbService';
import * as XLSX from 'xlsx';

const INITIAL_PREFERENCES: ContentPreferences = {
  postType: 'Thought Leadership',
  tone: 'Professional',
  length: 'Medium',
  useEmojis: true,
  includeCTA: true
};

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const App: React.FC = () => {
  const [step, setStep] = useState<WorkflowStep>(WorkflowStep.SOURCE_SELECTION);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<LinkedInUser | null>(null);
  const [allAccounts, setAllAccounts] = useState<LinkedInUser[]>([]);

  // Check Auth Status and Accounts on Load
  const checkAuth = async () => {
    try {
      const statusRes = await fetch(`${API_BASE_URL}/api/auth/status`, {
        credentials: 'include'
      });
      const statusData = await statusRes.json();

      if (statusData.connected && statusData.user) {
        setIsAuthenticated(true);
        setUser(statusData.user);

        // Load all connected accounts
        const accountsRes = await fetch(`${API_BASE_URL}/api/auth/accounts`, {
          credentials: 'include'
        });
        const accountsData = await accountsRes.json();
        setAllAccounts(accountsData.accounts || []);
      } else {
        setStep(WorkflowStep.LOGIN);
      }
    } catch (e) {
      console.error("Backend not connected", e);
      setStep(WorkflowStep.LOGIN);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Handle OAuth Popup Messages
  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'LINKEDIN_AUTH_SUCCESS') {
        setHistoryLoaded(false); // Stop persistence
        checkAuth();
        // Reset working data for the new account
        setData(prev => ({
          ...prev,
          sourceType: 'ai-guided',
          manualEntries: [],
          aiBrief: '',
          posts: [],
          history: [] // Clear old history immediately
        }));
        setStep(WorkflowStep.SOURCE_SELECTION);
      }
    };
    window.addEventListener('message', handleAuthMessage);
    return () => window.removeEventListener('message', handleAuthMessage);
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const result = await res.json();

      if (result.success) {
        setIsAuthenticated(false);
        setUser(null);
        setAllAccounts([]);
        setData(prev => ({
          ...prev,
          history: [],
          manualEntries: [],
          posts: []
        }));
        setHistoryLoaded(false);
        setStep(WorkflowStep.LOGIN);
      }
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  const fetchAiInsights = async (posts: any[]) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ posts })
      });
      const result = await response.json();
      setAiInsights(result);
    } catch (e) {
      console.error("Failed to fetch AI insights", e);
    }
  };

  const handleLinkedInLogin = () => {
    const width = 600, height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    window.open(
      `${API_BASE_URL}/auth/linkedin`,
      'LinkedIn Auth',
      `width=${width},height=${height},left=${left},top=${top}`
    );
  };
  const [data, setData] = useState<WorkflowData>({
    sourceType: 'ai-guided',
    manualEntries: [],
    aiBrief: '',
    startDate: new Date().toISOString().split('T')[0],
    frequency: 7,
    preferredTime: '10:00',
    preferences: INITIAL_PREFERENCES,
    posts: [],
    history: []
  });
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user?.urn) return;

      try {
        // 1. Load from Server first for the latest background status
        const serverRes = await fetch(`${API_BASE_URL}/api/history`, {
          credentials: 'include'
        });
        const serverData = await serverRes.json();

        let history = serverData.history;

        // 2. Fallback/Migration: Check IndexedDB if server is empty
        if (!history || history.length === 0) {
          history = await getHistory(user.urn);
        }

        // 3. Migration: Check if there's old data in localStorage
        const oldHistory = localStorage.getItem('linkup_history');
        if (oldHistory && (!history || history.length === 0)) {
          try {
            history = JSON.parse(oldHistory);
            localStorage.removeItem('linkup_history');
          } catch (migrateErr) {
            console.error("Migration failed", migrateErr);
          }
        }

        setData(prev => ({ ...prev, history: history || [] }));
        setHistoryLoaded(true);
      } catch (e) {
        console.error("Failed to load history", e);
        setHistoryLoaded(true);
      }
    };
    loadHistory();
  }, [user?.urn]);

  useEffect(() => {
    const persistHistory = async () => {
      if (!user?.urn || !historyLoaded) return;
      try {
        // Always save to IndexedDB for offline access
        await saveHistory(data.history, user.urn);

        // Also sync to server for background scheduling
        await fetch(`${API_BASE_URL}/api/history/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ history: data.history })
        });
      } catch (e) {
        console.error("Failed to persist history", e);
        setError("Storage limit reached or connection error. Background scheduling might be affected.");
      }
    };
    persistHistory();
  }, [data.history, user?.urn, historyLoaded]);
  const [loading, setLoading] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dashboardTab, setDashboardTab] = useState<'unified' | 'calendar' | 'analytics'>('unified');
  const [aiInsights, setAiInsights] = useState<{ summary: string; tips: string[] } | null>(null);
  const [isFromHistory, setIsFromHistory] = useState(false);

  useEffect(() => {
    if (dashboardTab === 'analytics' && !aiInsights) {
      const fetchInsights = async () => {
        try {
          const allPosts = data.history.length > 0 ? data.history : data.posts;
          const response = await fetch(`${API_BASE_URL}/api/ai/insights`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ posts: allPosts })
          });
          const result = await response.json();
          setAiInsights(result);
        } catch (e) {
          console.error("Failed to fetch AI insights", e);
        }
      };
      fetchInsights();
    }
  }, [dashboardTab, aiInsights, data.history, data.posts]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      // We still want to see countdowns etc, but we let the backend handle the actual publishing.
      // However, we should poll the server for the latest status if the user is on the dashboard.
      if (step === WorkflowStep.DASHBOARD && user?.urn) {
        fetch(`${API_BASE_URL}/api/history`, { credentials: 'include' })
          .then(res => res.json())
          .then(serverData => {
            if (serverData.history) {
              setData(prev => ({ ...prev, history: serverData.history }));
            }
          })
          .catch(console.error);
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [step, user?.urn]);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRegenPrompt, setShowRegenPrompt] = useState<string | null>(null);
  const [regenInstruction, setRegenInstruction] = useState('');

  const nextStep = () => {
    setStep(current => {
      if (current === WorkflowStep.SOURCE_SELECTION) {
        return data.sourceType === 'manual' ? WorkflowStep.PREFERENCES : WorkflowStep.SCHEDULING;
      }
      if (current === WorkflowStep.SCHEDULING) {
        return WorkflowStep.PREFERENCES;
      }
      return current;
    });
  };

  const prevStep = () => {
    setStep(current => {
      if (current === WorkflowStep.PREFERENCES) {
        return data.sourceType === 'manual' ? WorkflowStep.SOURCE_SELECTION : WorkflowStep.SCHEDULING;
      }
      if (current === WorkflowStep.SCHEDULING) {
        return WorkflowStep.SOURCE_SELECTION;
      }
      if (current === WorkflowStep.REVIEW) {
        return WorkflowStep.PREFERENCES;
      }
      return current;
    });
  };

  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rows = XLSX.utils.sheet_to_json(ws) as any[];

      const entries: PostInput[] = rows
        .filter(row => row.Topic || row.topic || row.Title || row.title) // Only keep rows with a topic
        .map(row => ({
          title: row.Topic || row.topic || row.Title || row.title || "Untitled Post",
          date: row.Date || row.date || new Date().toISOString().split('T')[0],
          time: row.Time || row.time || "09:00",
          content: row.Content || row.content || undefined
        }));

      setData(prev => ({ ...prev, manualEntries: entries, sourceType: 'manual' }));
    };
    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const templateData = [
      { Topic: 'Example Topic', Content: 'Optional: Paste your pre-written content here. If empty, AI will generate it.' },
      { Topic: 'Benefits of AI in IAM', Content: '' }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "LinkUp_Scheduler_Template.xlsx");
  };

  const startGeneration = async () => {
    setLoading(true);
    setError(null);
    setIsFromHistory(false);
    setStep(WorkflowStep.GENERATION);

    const postCount = data.sourceType === 'manual' ? data.manualEntries.length : (typeof data.frequency === 'number' ? data.frequency : 7);

    try {
      // 1. Generate Text Content for entries that need it
      const entriesToGenerate = data.manualEntries.filter(m => !m.content);
      const manualPostsWithContent = data.manualEntries.filter(m => m.content);

      let textResults: Partial<GeneratedPost>[] = [];

      if (data.sourceType === 'ai-guided') {
        textResults = await generatePostsText(
          data.sourceType,
          { brief: data.aiBrief },
          data.preferences,
          postCount
        );
      } else {
        // For manual entries, we call AI to get infographics prompts and hashtags for all entries
        textResults = await generatePostsText(
          data.sourceType,
          { manualEntries: data.manualEntries },
          data.preferences,
          data.manualEntries.length
        );

        // Refined Manual Entry Logic:
        // 1. Title + Content provided -> Use that text exactly (no bolding/rewriting).
        // 2. Title only provided -> Use AI to generate the full post body.
        textResults = textResults.map((res, idx) => {
          const manualEntry = data.manualEntries[idx];
          const hasTitle = manualEntry.title && manualEntry.title !== "Untitled Post";
          const hasContent = !!manualEntry.content;

          if (hasTitle && hasContent) {
            return {
              ...res, // Still use AI's hashtags and imagePrompt
              content: manualEntry.content,
              headline: manualEntry.title
            };
          }
          return res;
        });
      }

      // 2. Generate Images & Combine
      const finalPosts: GeneratedPost[] = [];
      const loopCount = data.sourceType === 'manual' ? data.manualEntries.length : postCount;

      for (let i = 0; i < loopCount; i++) {
        setGenProgress(Math.round(((i + 0.1) / loopCount) * 100));
        const res = textResults[i] || {};

        let imageUrl = (data.sourceType === 'manual' && data.manualEntries[i]) ? data.manualEntries[i].imageUrl : "";
        if (!imageUrl && res.imagePrompt) {
          imageUrl = await generatePostImage(res.imagePrompt);
        }

        let scheduledAt: string;
        try {
          if (data.sourceType === 'manual' && data.manualEntries[i]) {
            const entry = data.manualEntries[i];
            let parsedDate = new Date(`${entry.date} ${entry.time}`);
            if (isNaN(parsedDate.getTime())) parsedDate = new Date();
            scheduledAt = parsedDate.toISOString();
          } else {
            const [y, mm, dd] = data.startDate.split('-').map(Number);
            const baseDate = new Date(y, mm - 1, dd);
            const date = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
            const timeInput = data.preferredTime || "10:00";
            const [h, m] = timeInput.split(':').map(val => parseInt(val) || 0);
            date.setHours(h, m, 0, 0);
            scheduledAt = date.toISOString();
          }
        } catch (e) {
          scheduledAt = new Date().toISOString();
        }

        // Final determination of headline and content
        let finalHeadline = res.headline;
        let finalContent = res.content;

        if (data.sourceType === 'manual' && data.manualEntries[i]) {
          const manualEntry = data.manualEntries[i];
          // User provided both - keep their original text exactly (no bolding/rewriting)
          if (manualEntry.title && manualEntry.content) {
            finalHeadline = manualEntry.title;
            finalContent = manualEntry.content;
          } else if (manualEntry.title && !finalContent) {
            // If only title provided and AI failed, keep the manual title at least
            finalHeadline = manualEntry.title;
            finalContent = "Insights for: " + manualEntry.title;
          }
        }

        finalPosts.push({
          id: Math.random().toString(36).substr(2, 9),
          headline: finalHeadline || "New Post",
          content: finalContent || "Building content...",
          hashtags: res.hashtags || [],
          imageUrl: imageUrl || "",
          imagePrompt: res.imagePrompt || "",
          scheduledAt,
          status: 'pending',
          source: data.sourceType === 'manual' ? 'manual' : 'ai-generated'
        });
        setGenProgress(Math.round(((i + 1) / loopCount) * 100));
      }

      setData(prev => ({ ...prev, posts: finalPosts }));
      setStep(WorkflowStep.REVIEW);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong during generation. Please check your API key and connection.");
    } finally {
      setLoading(false);
      setGenProgress(0);
    }
  };

  const handleScheduleAll = async () => {
    setLoading(true);
    // Mark all as scheduled and move to history
    const newlyScheduled = data.posts.map(p => ({
      ...p,
      status: 'scheduled' as const
    }));

    setData(prev => {
      const existingIds = new Set(newlyScheduled.map(p => p.id));
      const filteredHistory = prev.history.filter(p => !existingIds.has(p.id));
      return {
        ...prev,
        posts: [],
        history: [...newlyScheduled, ...filteredHistory]
      };
    });

    setLoading(false);
    setStep(WorkflowStep.DASHBOARD);
  };

  const publishPost = async (post: GeneratedPost) => {
    console.log(`Attempting to publish post ${post.id}: "${post.headline}"`);
    try {
      const response = await fetch(`${API_BASE_URL}/api/publish/linkedin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          headline: post.headline,
          content: post.content,
          imageUrl: post.imageUrl,
          hashtags: post.hashtags
        })
      });

      const result = await response.json();
      console.log(`Publish response for ${post.id}:`, result);

      if (result.success) {
        console.log(`Success! Post ${post.id} published.`);
        setData(prev => ({
          ...prev,
          history: prev.history.map(p => p.id === post.id ? { ...p, status: 'published' as const } : p)
        }));
        return true;
      } else {
        console.error(`Publish failed for ${post.id}:`, result.error);
        setData(prev => ({
          ...prev,
          history: prev.history.map(p => p.id === post.id ? { ...p, status: 'failed' as const } : p)
        }));
        return false;
      }
    } catch (err) {
      console.error(`Network error while publishing ${post.id}:`, err);
      setData(prev => ({
        ...prev,
        history: prev.history.map(p => p.id === post.id ? { ...p, status: 'failed' as const } : p)
      }));
      return false;
    }
  };

  const handleUpdatePost = (postId: string, updatedFields: Partial<GeneratedPost>) => {
    setData(prev => ({
      ...prev,
      posts: prev.posts.map(p => p.id === postId ? { ...p, ...updatedFields } : p),
      history: prev.history.map(p => p.id === postId ? { ...p, ...updatedFields } : p)
    }));
  };

  const handleDeletePost = (postId: string) => {
    setData(prev => ({
      ...prev,
      posts: prev.posts.filter(p => p.id !== postId)
    }));
  };

  const handleDeleteFromHistory = (postId: string) => {
    setData(prev => ({
      ...prev,
      history: prev.history.filter(p => p.id !== postId)
    }));
  };

  const handleReviewPost = (post: GeneratedPost) => {
    setData(prev => ({
      ...prev,
      posts: [post]
    }));
    setIsFromHistory(true);
    setStep(WorkflowStep.REVIEW);
  };

  const handleRegeneratePostImage = async (postId: string, imagePrompt: string) => {
    const post = data.posts.find(p => p.id === postId);
    if (!post) return;

    setLoading(true);
    try {
      const newImageUrl = await generatePostImage(imagePrompt || post.imagePrompt);
      handleUpdatePost(postId, { imageUrl: newImageUrl });
    } catch (err) {
      console.error(err);
      alert("Failed to regenerate image.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegeneratePostText = async (postId: string, instruction?: string) => {
    const post = data.posts.find(p => p.id === postId);
    if (!post) return;

    setLoading(true);
    try {
      // For regeneration, we use the existing brief and preferences
      // but only for 1 post.
      const results = await generatePostsText(
        data.sourceType,
        {
          brief: data.aiBrief,
          manualEntries: data.sourceType === 'manual' ? [{ title: post.headline, date: '', time: '' }] : undefined,
          customInstructions: instruction
        },
        data.preferences,
        1
      );

      if (results && results[0]) {
        const res = results[0];
        handleUpdatePost(postId, {
          headline: res.headline,
          content: res.content,
          hashtags: res.hashtags,
          imagePrompt: res.imagePrompt
        });
      }
    } catch (err) {
      console.error(err);
      alert("Failed to regenerate post text.");
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (postId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        handleUpdatePost(postId, { imageUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const renderStep = () => {
    switch (step) {
      case WorkflowStep.LOGIN:
        return (
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-12 py-20 animate-fadeIn">
            <div className="flex-1 space-y-8 text-center md:text-left">
              <div className="inline-block px-4 py-2 bg-blue-100 text-blue-600 rounded-full text-xs font-black uppercase tracking-widest">
                AI-Powered LinkedIn Growth
              </div>
              <h1 className="text-6xl font-black text-slate-900 leading-tight">
                Scale your <span className="text-blue-600">LinkedIn</span> Presence.
              </h1>
              <p className="text-xl text-slate-500 font-medium leading-relaxed">
                Connect your account to start generating, scheduling, and analyzing your LinkedIn content with cutting-edge AI.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <button
                  onClick={handleLinkedInLogin}
                  className="px-8 py-5 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 shadow-2xl shadow-blue-200 transition-all flex items-center justify-center gap-3 active:scale-95"
                >
                  <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.238 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
                  Connect with LinkedIn
                </button>
              </div>
              <div className="flex items-center gap-6 pt-8 text-slate-400">
                <div className="flex -space-x-3">
                  {[1, 2, 3, 4].map(i => <div key={i} className="w-10 h-10 rounded-full border-4 border-white bg-slate-200" />)}
                </div>
                <p className="text-sm font-bold italic">Join 2,000+ top creators</p>
              </div>
            </div>
            <div className="flex-1 w-full flex justify-center">
              <div className="relative w-full max-w-sm aspect-square bg-blue-600 rounded-[3rem] rotate-3 flex items-center justify-center overflow-hidden shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-blue-700 opacity-50" />
                <div className="relative text-white space-y-4 p-8 -rotate-3">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center text-2xl">✨</div>
                  <h3 className="text-2xl font-black">AI Orchestration</h3>
                  <p className="opacity-80 font-bold">Your personal content team, running on autopilot.</p>
                </div>
              </div>
            </div>
          </div>
        );
      case WorkflowStep.SOURCE_SELECTION:
        return (
          <div className="max-w-2xl mx-auto space-y-8 animate-fadeIn">
            <h2 className="text-3xl font-bold text-center">How should we start?</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button
                onClick={() => setData(prev => ({ ...prev, sourceType: 'ai-guided' }))}
                className={`p-6 border-2 rounded-xl text-left transition-all ${data.sourceType === 'ai-guided' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="text-3xl mb-4">✨</div>
                <h3 className="text-lg font-bold">AI-Guided Creation</h3>
                <p className="text-sm text-slate-500 mt-2">Describe your goal and let AI handle the heavy lifting.</p>
              </button>
              <button
                onClick={() => setData(prev => ({ ...prev, sourceType: 'manual' }))}
                className={`p-6 border-2 rounded-xl text-left transition-all ${data.sourceType === 'manual' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="text-3xl mb-4">📅</div>
                <h3 className="text-lg font-bold">Manual Scheduling</h3>
                <p className="text-sm text-slate-500 mt-2">Paste a list of topics or dates from your content calendar.</p>
              </button>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              {data.sourceType === 'ai-guided' ? (
                <div className="space-y-4">
                  <label className="block text-sm font-semibold">Your Brand or Topic Brief</label>
                  <textarea
                    className="w-full h-32 p-4 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g., I run an AI startup focused on healthcare analytics. I want thought-leadership posts about data privacy and the future of diagnosis."
                    value={data.aiBrief}
                    onChange={(e) => setData(prev => ({ ...prev, aiBrief: e.target.value }))}
                  />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <label className="block text-sm font-semibold text-slate-700">Upload Content Calendar (Excel/CSV)</label>
                    <button
                      onClick={downloadTemplate}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Download Template
                    </button>
                  </div>

                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-blue-400 transition-colors relative group">
                    <input
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleManualUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="space-y-2">
                      <div className="text-4xl mx-auto text-slate-400 group-hover:text-blue-500 transition-colors">📊</div>
                      <p className="text-sm font-medium text-slate-600">
                        {data.manualEntries.length > 0
                          ? `✅ ${data.manualEntries.length} entries loaded`
                          : "Drop your file here or click to browse"}
                      </p>
                      <p className="text-xs text-slate-400">Supports .xlsx, .xls and .csv</p>
                    </div>
                  </div>

                  {data.manualEntries.length > 0 && (
                    <div className="bg-slate-50 rounded-lg p-4 max-h-64 overflow-y-auto border border-slate-100 italic text-[10px] text-slate-500">
                      <p className="font-bold mb-2 uppercase tracking-wider text-slate-700 not-italic">Loaded Entries:</p>
                      <div className="space-y-3">
                        {data.manualEntries.map((e, i) => (
                          <div key={i} className="flex flex-col bg-white p-3 rounded-lg border border-slate-200 shadow-sm not-italic group gap-3">
                            <div className="flex justify-between items-start">
                              <div className="flex-1 min-w-0 pr-4">
                                <p className="font-bold text-slate-900 truncate">{e.title}</p>
                                {e.content && <p className="text-[9px] text-blue-500 line-clamp-1 mt-1 font-semibold italic">"{e.content.substring(0, 50)}..."</p>}
                              </div>
                              <button
                                onClick={() => {
                                  const newEntries = data.manualEntries.filter((_, idx) => idx !== i);
                                  setData(prev => ({ ...prev, manualEntries: newEntries }));
                                }}
                                className="text-slate-300 hover:text-red-500 transition-colors"
                              >
                                ✕
                              </button>
                            </div>

                            <div className="flex items-center gap-3 pt-2 border-t border-slate-50">
                              <div className="flex-1 space-y-1">
                                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Date</label>
                                <input
                                  type="date"
                                  value={e.date}
                                  onChange={(ev) => {
                                    const newEntries = [...data.manualEntries];
                                    newEntries[i] = { ...newEntries[i], date: ev.target.value };
                                    setData(prev => ({ ...prev, manualEntries: newEntries }));
                                  }}
                                  className="w-full p-1 border border-slate-100 rounded text-[10px] outline-none focus:border-blue-500"
                                />
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Time</label>
                                <input
                                  type="time"
                                  value={e.time.includes('M') ? "09:00" : e.time} // Handle conversion from 12h to 24h if needed, or just let users set it
                                  onChange={(ev) => {
                                    const newEntries = [...data.manualEntries];
                                    newEntries[i] = { ...newEntries[i], time: ev.target.value };
                                    setData(prev => ({ ...prev, manualEntries: newEntries }));
                                  }}
                                  className="w-full p-1 border border-slate-100 rounded text-[10px] outline-none focus:border-blue-500"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                {e.imageUrl ? (
                                  <div className="relative w-10 h-10 rounded overflow-hidden border border-blue-500 ring-2 ring-blue-100">
                                    <img src={e.imageUrl} className="w-full h-full object-cover" alt="Uploaded thumbnail" />
                                    <button
                                      onClick={() => {
                                        const newEntries = [...data.manualEntries];
                                        newEntries[i] = { ...newEntries[i], imageUrl: undefined };
                                        setData(prev => ({ ...prev, manualEntries: newEntries }));
                                      }}
                                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <label className="w-10 h-10 flex flex-col items-center justify-center border border-dashed border-slate-300 rounded cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all text-slate-400">
                                    <span className="text-[8px] font-bold uppercase">Image</span>
                                    <input
                                      type="file"
                                      className="hidden"
                                      accept="image/*"
                                      onChange={(ev) => {
                                        const file = ev.target.files?.[0];
                                        if (file) {
                                          const reader = new FileReader();
                                          reader.onloadend = () => {
                                            const newEntries = [...data.manualEntries];
                                            newEntries[i] = { ...newEntries[i], imageUrl: reader.result as string };
                                            setData(prev => ({ ...prev, manualEntries: newEntries }));
                                          };
                                          reader.readAsDataURL(file);
                                        }
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              disabled={data.sourceType === 'ai-guided' ? !data.aiBrief : data.manualEntries.length === 0}
              onClick={nextStep}
              className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {data.sourceType === 'manual' ? "Continue to Content Preferences" : "Continue to Scheduling"}
            </button>
          </div>
        );

      case WorkflowStep.SCHEDULING:
        return (
          <div className="max-w-2xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold text-center">Post frequency & duration</h2>
            <div className="grid grid-cols-3 gap-4">
              {[7, 15, 30].map(days => (
                <button
                  key={days}
                  onClick={() => setData(prev => ({ ...prev, frequency: days as any }))}
                  className={`py-6 rounded-xl border-2 transition-all ${data.frequency === days ? 'border-blue-500 bg-blue-50 font-bold' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  {days} Days
                </button>
              ))}
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="text-xl">📅</span> Review of Timeline
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm py-2 border-b border-slate-50">
                  <span className="text-slate-500">Total Posts</span>
                  <span className="font-bold">{data.sourceType === 'manual' ? data.manualEntries.length : data.frequency}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-slate-500 text-sm">Campaign Start Date</span>
                  <input
                    type="date"
                    value={data.startDate}
                    onChange={(e) => setData(prev => ({ ...prev, startDate: e.target.value }))}
                    className="p-2 border border-slate-200 rounded-lg text-sm font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-500 text-sm">Preferred Posting Time</span>
                  <input
                    type="time"
                    value={data.preferredTime}
                    onChange={(e) => setData(prev => ({ ...prev, preferredTime: e.target.value }))}
                    className="p-2 border border-slate-200 rounded-lg text-sm font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={prevStep} className="flex-1 py-4 border border-slate-200 rounded-xl font-bold hover:bg-slate-50">Back</button>
              <button onClick={nextStep} className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">Next: Content Vibes</button>
            </div>
          </div>
        );

      case WorkflowStep.PREFERENCES:
        return (
          <div className="max-w-2xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold text-center">Fine-tune the content</h2>

            <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">Post Type</label>
                  <select
                    value={data.preferences.postType}
                    onChange={(e) => setData(prev => ({ ...prev, preferences: { ...prev.preferences, postType: e.target.value as any } }))}
                    className="w-full p-3 border border-slate-200 rounded-lg outline-none"
                  >
                    <option>Thought Leadership</option>
                    <option>Educational</option>
                    <option>Storytelling</option>
                    <option>Promotional</option>
                    <option>Hiring</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">Tone</label>
                  <select
                    value={data.preferences.tone}
                    onChange={(e) => setData(prev => ({ ...prev, preferences: { ...prev.preferences, tone: e.target.value as any } }))}
                    className="w-full p-3 border border-slate-200 rounded-lg outline-none"
                  >
                    <option>Professional</option>
                    <option>Conversational</option>
                    <option>Inspirational</option>
                    <option>Bold</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-semibold">Post Length</label>
                <div className="flex gap-4">
                  {['Short', 'Medium', 'Long-form'].map(len => (
                    <button
                      key={len}
                      onClick={() => setData(prev => ({ ...prev, preferences: { ...prev.preferences, length: len as any } }))}
                      className={`flex-1 py-3 border-2 rounded-lg transition-all ${data.preferences.length === len ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      {len}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <span className="font-medium">Enable Emojis</span>
                <button
                  onClick={() => setData(prev => ({ ...prev, preferences: { ...prev.preferences, useEmojis: !prev.preferences.useEmojis } }))}
                  className={`w-12 h-6 rounded-full transition-colors relative ${data.preferences.useEmojis ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${data.preferences.useEmojis ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <span className="font-medium">Include Call-to-Action</span>
                <button
                  onClick={() => setData(prev => ({ ...prev, preferences: { ...prev.preferences, includeCTA: !prev.preferences.includeCTA } }))}
                  className={`w-12 h-6 rounded-full transition-colors relative ${data.preferences.includeCTA ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${data.preferences.includeCTA ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={prevStep} className="flex-1 py-4 border border-slate-200 rounded-xl font-bold hover:bg-slate-50">Back</button>
              <button onClick={startGeneration} className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">Generate Content</button>
            </div>
          </div>
        );

      case WorkflowStep.GENERATION:
        return (
          <div className="max-w-2xl mx-auto flex flex-col items-center justify-center py-20 space-y-8">
            {error ? (
              <div className="text-center space-y-6 animate-fadeIn">
                <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-4xl mb-4">⚠️</div>
                <h2 className="text-2xl font-bold text-slate-900">Generation Failed</h2>
                <p className="text-slate-500 max-w-md mx-auto">{error}</p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={() => { setError(null); setStep(WorkflowStep.PREFERENCES); }}
                    className="px-8 py-3 border border-slate-300 rounded-xl font-bold hover:bg-slate-50 transition-colors"
                  >
                    Back to Preferences
                  </button>
                  <button
                    onClick={startGeneration}
                    className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg"
                  >
                    Retry Generation
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="w-24 h-24 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-2">AI is Crafting Your Strategy...</h2>
                  <p className="text-slate-500">We're generating human-like posts and professional visuals.</p>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${genProgress}%` }} />
                </div>
                <p className="font-mono text-sm text-blue-600">{genProgress}% Complete</p>
                <button
                  onClick={() => setStep(WorkflowStep.PREFERENCES)}
                  className="mt-8 text-slate-400 hover:text-slate-600 text-sm font-semibold flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                  Cancel & Go Back
                </button>
              </>
            )}
          </div>
        );

      case WorkflowStep.REVIEW:
        return (
          <div className="max-w-5xl mx-auto space-y-8 mb-20">
            <div className="flex justify-between items-center">
              <div className="space-y-1">
                <h2 className="text-3xl font-bold">Review & Approve</h2>
                <p className="text-slate-500">Fine-tune each post before scheduling.</p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => setStep(isFromHistory ? WorkflowStep.DASHBOARD : WorkflowStep.PREFERENCES)}
                  className="px-6 py-3 border border-slate-300 rounded-lg font-semibold hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  onClick={handleScheduleAll}
                  className="px-8 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-lg transition-all transform hover:scale-105"
                >
                  Confirm Schedule
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {data.posts.map((post, idx) => {
                const isEditing = editingPostId === post.id;

                return (
                  <div key={post.id} className={`bg-white border rounded-2xl overflow-hidden shadow-sm flex flex-col transition-all ${isEditing ? 'ring-2 ring-blue-500 border-transparent' : 'border-slate-200'}`}>
                    {/* Card Header */}
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Post #{idx + 1}</span>
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={(() => {
                              const d = new Date(post.scheduledAt);
                              return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                            })()}
                            onChange={(e) => {
                              const localDate = new Date(e.target.value);
                              handleUpdatePost(post.id, { scheduledAt: localDate.toISOString() });
                            }}
                            className="text-[10px] font-bold text-blue-600 bg-blue-50/50 p-1 px-2 rounded border border-blue-200 focus:border-blue-500 outline-none w-full mt-1"
                          />
                        ) : (
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 p-1 px-2 rounded mt-1">
                            {new Date(post.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingPostId(isEditing ? null : post.id)}
                          className={`p-2 rounded-lg transition-colors ${isEditing ? 'bg-blue-600 text-white' : 'hover:bg-slate-200 text-slate-500'}`}
                          title={isEditing ? "Save & Close" : "Edit Post"}
                        >
                          {isEditing ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          )}
                        </button>
                        <button
                          onClick={() => handleDeletePost(post.id)}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-400"
                          title="Delete"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>

                    {/* Card Media */}
                    <div className="relative aspect-video bg-slate-100 group">
                      {post.imageUrl ? (
                        <img src={post.imageUrl} className="w-full h-full object-cover" alt="Post graphic" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </div>
                      )}

                      {/* Media Overlays */}
                      <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 font-sans">
                        <button
                          onClick={() => handleRegeneratePostImage(post.id, post.imagePrompt)}
                          className="flex-1 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg text-[10px] font-bold shadow-xl hover:bg-white transition-colors flex items-center justify-center gap-2"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          Regenerate
                        </button>
                        <label className="flex-1 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg text-[10px] font-bold shadow-xl hover:bg-white transition-colors cursor-pointer flex items-center justify-center gap-2 text-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                          Upload
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(post.id, e)} />
                        </label>
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-6 space-y-4 flex-1">
                      {isEditing ? (
                        <div className="space-y-4 animate-fadeIn">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Headline</label>
                            <input
                              type="text"
                              value={post.headline}
                              onChange={(e) => handleUpdatePost(post.id, { headline: e.target.value })}
                              className="w-full text-lg font-bold leading-tight border-b border-slate-200 focus:border-blue-500 outline-none pb-1"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Body Content</label>
                            <textarea
                              value={post.content}
                              onChange={(e) => handleUpdatePost(post.id, { content: e.target.value })}
                              className="w-full text-sm text-slate-600 whitespace-pre-wrap border border-slate-200 rounded-lg p-3 min-h-[150px] focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Hashtags (comma separated)</label>
                            <input
                              type="text"
                              value={post.hashtags.join(', ')}
                              onChange={(e) => handleUpdatePost(post.id, { hashtags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                              className="w-full text-xs font-semibold text-blue-600 border border-slate-200 rounded-lg p-2 focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </div>
                          <button
                            onClick={() => setShowRegenPrompt(post.id)}
                            className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            Regenerate Text with AI
                          </button>
                        </div>
                      ) : (
                        <>
                          <h3 className="text-lg font-bold leading-tight">{post.headline}</h3>
                          <p className="text-sm text-slate-600 whitespace-pre-wrap">{post.content}</p>
                          <div className="flex flex-wrap gap-2 pt-2">
                            {post.hashtags.map(tag => (
                              <span key={tag} className="text-blue-600 text-xs font-semibold hover:underline cursor-pointer">#{tag.replace(/^#/, '')}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-center py-10">
              {/* Spacer */}
            </div>
          </div>
        );

      case WorkflowStep.DASHBOARD:
        const now = currentTime;
        const timelinePosts = [...data.history].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

        const upcomingPosts = timelinePosts.filter(p => p.status === 'scheduled' || p.status === 'pending');
        const pastPosts = timelinePosts.filter(p => p.status === 'published' || p.status === 'failed');

        const getNextPostCountdown = () => {
          if (upcomingPosts.length === 0) return null;
          const nextDate = new Date(upcomingPosts[0].scheduledAt);
          const diffMs = nextDate.getTime() - now.getTime();
          if (diffMs <= 0) return "Publishing now...";

          const hours = Math.floor(diffMs / (1000 * 60 * 60));
          const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          return `${hours}h ${mins}m`;
        };

        const countdown = getNextPostCountdown();

        // Calendar Grouping
        const postsByDate: Record<string, typeof timelinePosts> = {};
        timelinePosts.forEach(p => {
          const d = new Date(p.scheduledAt).toLocaleDateString();
          if (!postsByDate[d]) postsByDate[d] = [];
          postsByDate[d].push(p);
        });

        return (
          <div className="max-w-6xl mx-auto space-y-12 animate-fadeIn">
            <div className="flex justify-between items-center bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
              <div className="relative">
                <h2 className="text-3xl font-bold text-slate-900">Content Hub</h2>
                <p className="text-slate-500 mt-1">Manage your history and upcoming schedule</p>
              </div>
              <button
                onClick={() => setStep(WorkflowStep.SOURCE_SELECTION)}
                className="relative px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg transition-all transform hover:scale-105"
              >
                + New Campaign
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: 'Total Posts', value: timelinePosts.length, icon: '📚' },
                { label: 'Scheduled', value: upcomingPosts.length, icon: '⏳' },
                { label: 'Published', value: pastPosts.length, icon: '✅' },
                { label: 'AI Gen', value: timelinePosts.filter(p => p.source === 'ai-generated').length, icon: '✨' },
              ].map(stat => (
                <div key={stat.label} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-200 transition-colors">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-2xl">{stat.icon}</span>
                  </div>
                  <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wider">{stat.label}</h3>
                  <div className="text-4xl font-black mt-1 text-slate-900">{stat.value}</div>
                </div>
              ))}
            </div>

            <div className="space-y-8">
              <div className="flex items-center gap-6 border-b border-slate-200 pb-1 overflow-x-auto scrollbar-hide">
                <button
                  onClick={() => setDashboardTab('unified')}
                  className={`px-4 py-3 border-b-2 transition-all ${dashboardTab === 'unified' ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-400 font-medium hover:text-slate-600'}`}
                >
                  Unified History
                </button>
                <button
                  onClick={() => setDashboardTab('calendar')}
                  className={`px-4 py-3 border-b-2 transition-all ${dashboardTab === 'calendar' ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-400 font-medium hover:text-slate-600'}`}
                >
                  Calendar View
                </button>
                <button
                  onClick={() => setDashboardTab('analytics')}
                  className={`px-4 py-3 border-b-2 transition-all ${dashboardTab === 'analytics' ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-400 font-medium hover:text-slate-600'}`}
                >
                  Analytics
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                <div className="lg:col-span-2 space-y-6">
                  {dashboardTab === 'unified' && (
                    <>
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <span className="w-2 h-6 bg-blue-600 rounded-full" />
                        Complete Timeline
                      </h3>
                      {timelinePosts.length === 0 ? (
                        <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                          <div className="text-4xl mb-4">📭</div>
                          <p className="text-slate-500 font-medium">No posts found in history.</p>
                          <button onClick={() => setStep(WorkflowStep.SOURCE_SELECTION)} className="mt-4 text-blue-600 font-bold hover:underline">Start your first campaign</button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {timelinePosts.map((post) => (
                            <div key={post.id} className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-all flex flex-col md:flex-row gap-6 relative overflow-hidden">
                              <div className={`absolute top-0 right-0 px-3 py-1 text-[8px] font-black uppercase tracking-tighter rounded-bl-lg ${post.source === 'ai-generated' ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-600'}`}>
                                {post.source === 'ai-generated' ? '✨ AI Gen' : '📄 Manual'}
                              </div>
                              <div className="w-full md:w-32 h-24 bg-slate-100 rounded-xl overflow-hidden flex-shrink-0 border border-slate-100">
                                {post.imageUrl ? <img src={post.imageUrl} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-slate-300">🖼️</div>}
                              </div>
                              <div className="flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-3">
                                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${post.status === 'scheduled' ? 'bg-blue-50 text-blue-600' : post.status === 'published' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                                    {post.status}
                                  </span>
                                  <span className="text-xs font-bold text-slate-400">{post.scheduledAt}</span>
                                </div>
                                <h4 className="font-bold text-lg text-slate-800 line-clamp-1">{post.headline}</h4>
                                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{post.content}</p>
                              </div>
                              <div className="flex md:flex-col justify-center gap-2 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                                <button onClick={() => handleDeleteFromHistory(post.id)} className="flex-1 px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-red-100">Delete</button>
                                <button
                                  onClick={() => handleReviewPost(post)}
                                  className="flex-1 px-4 py-2 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors ring-1 ring-blue-100"
                                >
                                  Review & Edit
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {dashboardTab === 'calendar' && (
                    <div className="space-y-8 animate-fadeIn">
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <span className="w-2 h-6 bg-purple-600 rounded-full" />
                        Post Calendar
                      </h3>
                      {Object.keys(postsByDate).length === 0 ? (
                        <p className="text-slate-500 italic">No posts scheduled yet.</p>
                      ) : (
                        Object.entries(postsByDate).map(([date, posts]) => (
                          <div key={date} className="space-y-4">
                            <div className="sticky top-20 z-10 bg-slate-50/80 backdrop-blur-sm py-2">
                              <span className="bg-slate-900 text-white px-4 py-1 rounded-full text-xs font-bold">{date}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {posts.map(p => (
                                <div key={p.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex gap-4">
                                  <div className="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0">
                                    <img src={p.imageUrl} className="w-full h-full object-cover" alt="" />
                                  </div>
                                  <div className="min-w-0">
                                    <h5 className="font-bold text-sm truncate">{p.headline}</h5>
                                    <p className="text-[10px] text-slate-400 mt-1">{p.scheduledAt.split(',')[1]}</p>
                                    <span className={`inline-block mt-2 px-2 py-0.5 rounded-[4px] text-[8px] font-black uppercase ${p.status === 'scheduled' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>{p.status}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {dashboardTab === 'analytics' && (
                    <div className="space-y-8 animate-fadeIn">
                      <h3 className="text-xl font-bold flex items-center gap-2">
                        <span className="w-2 h-6 bg-green-600 rounded-full" />
                        Performance Insights
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                          <h4 className="font-bold text-slate-800">Content Mix</h4>
                          <div className="space-y-4">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-500">AI Generated</span>
                              <span className="font-bold text-purple-600">{Math.round((timelinePosts.filter(p => p.source === 'ai-generated').length / (timelinePosts.length || 1)) * 100)}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div className="bg-purple-500 h-full" style={{ width: `${(timelinePosts.filter(p => p.source === 'ai-generated').length / (timelinePosts.length || 1)) * 100}%` }} />
                            </div>
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-500">Manual Entry</span>
                              <span className="font-bold text-orange-600">{Math.round((timelinePosts.filter(p => p.source === 'manual').length / (timelinePosts.length || 1)) * 100)}%</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div className="bg-orange-500 h-full" style={{ width: `${(timelinePosts.filter(p => p.source === 'manual').length / (timelinePosts.length || 1)) * 100}%` }} />
                            </div>
                          </div>
                        </div>
                        <div className="bg-blue-600 p-8 rounded-3xl text-white space-y-4 shadow-xl shadow-blue-200">
                          <h4 className="font-bold opacity-80 uppercase tracking-widest text-[10px]">Estimated Reach</h4>
                          <div className="text-5xl font-black">{(timelinePosts.length * 150).toLocaleString()}+</div>
                          <p className="text-xs opacity-70 leading-relaxed">Based on your current posting frequency and industry benchmarks for LinkedIn engagement.</p>
                          <div className="pt-4 flex gap-4">
                            <div className="flex-1 bg-white/10 rounded-xl p-3">
                              <div className="text-[10px] opacity-60">Avg Engagements</div>
                              <div className="text-xl font-bold">24.5</div>
                            </div>
                            <div className="flex-1 bg-white/10 rounded-xl p-3">
                              <div className="text-[10px] opacity-60">Share Rate</div>
                              <div className="text-xl font-bold">4.2%</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* AI Brand Insights Section */}
                      <div className="bg-slate-900 rounded-3xl p-8 text-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-10 text-8xl">✨</div>
                        <div className="relative space-y-6">
                          <div className="flex items-center gap-3">
                            <span className="px-3 py-1 bg-blue-500 text-[10px] font-black uppercase rounded-full">AI Strategy Coach</span>
                            <h4 className="text-xl font-bold">Personal Brand Audit</h4>
                          </div>

                          {aiInsights ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                              <div className="md:col-span-2 space-y-4">
                                <p className="text-slate-400 leading-relaxed text-sm">
                                  {aiInsights.summary}
                                </p>
                              </div>
                              <div className="space-y-4">
                                <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Recommended Actions</p>
                                <ul className="space-y-3">
                                  {aiInsights.tips.map((tip, i) => (
                                    <li key={i} className="flex gap-3 text-xs font-medium text-slate-300">
                                      <span className="text-blue-500 font-black">•</span>
                                      {tip}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-4 py-4">
                              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                              <p className="text-slate-400 text-sm italic">Analyzing your content strategy...</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <h3 className="text-xl font-bold">Upcoming Next</h3>
                  <div className="bg-slate-900 text-white rounded-3xl p-8 space-y-6 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl">🔔</div>
                    {upcomingPosts.length > 0 ? (
                      <>
                        <div className="space-y-1">
                          <p className="text-blue-400 text-xs font-black uppercase tracking-widest">Next Post In</p>
                          <p className="text-3xl font-black">{countdown}</p>
                        </div>
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-3">
                          <p className="text-xs text-slate-400 font-medium">Primary Goal</p>
                          <p className="text-sm font-bold italic line-clamp-3">"{upcomingPosts[0].headline}"</p>
                          <div className="pt-2 border-t border-white/5 flex justify-between items-center">
                            <span className="text-[10px] text-blue-400 font-bold">LinkedIn</span>
                            <span className="text-[10px] text-slate-500">{upcomingPosts[0].scheduledAt}</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-4 py-4 text-center">
                        <p className="text-slate-400 text-sm">No upcoming posts scheduled.</p>
                        <button onClick={() => setStep(WorkflowStep.SOURCE_SELECTION)} className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-bold transition-colors">Setup Now</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-10 border-t border-slate-200 flex flex-col md:flex-row gap-6 items-center justify-between">
              <div className="text-sm text-slate-400 font-medium">© 2025 LinkUp AI. Professional Social Media Scheduler.</div>
              <div className="flex gap-8">
                <button className="text-slate-400 hover:text-slate-600 text-sm font-semibold transition-colors">Preferences</button>
                <button className="text-slate-400 hover:text-slate-600 text-sm font-semibold transition-colors">Account</button>
                <button className="text-slate-400 hover:text-slate-600 text-sm font-semibold transition-colors border-l pl-8">Support</button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header
        user={user}
        onLogout={handleLogout}
        onLoginAnother={handleLinkedInLogin}
        onViewDashboard={() => setStep(WorkflowStep.DASHBOARD)}
      />
      <main className="flex-1 p-6 md:p-12 overflow-auto">
        {step !== WorkflowStep.DASHBOARD && step !== WorkflowStep.GENERATION && step !== WorkflowStep.LOGIN && <StepIndicator currentStep={step} />}
        {renderStep()}
      </main>

      {showRegenPrompt && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 space-y-6 animate-fadeIn">
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-slate-900">Regenerate Post</h3>
              <p className="text-slate-500 text-sm">Would you like to provide any specific instructions for this post, or just regenerate it as is?</p>
            </div>

            <textarea
              value={regenInstruction}
              onChange={(e) => setRegenInstruction(e.target.value)}
              className="w-full h-32 p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              placeholder="e.g., Make it more educational, add a mention of 'Product X', or keep it professional but shorter."
            />

            <div className="flex gap-4">
              <button
                onClick={() => { setShowRegenPrompt(null); setRegenInstruction(''); }}
                className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleRegeneratePostText(showRegenPrompt, regenInstruction);
                  setShowRegenPrompt(null);
                  setRegenInstruction('');
                }}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg transition-all"
              >
                {regenInstruction ? 'Regenerate with Instructions' : 'Regenerate as is'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && step !== WorkflowStep.GENERATION && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="font-bold text-slate-900">Regenerating Post Text...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
