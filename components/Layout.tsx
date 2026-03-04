
import React, { useState } from 'react';
import { LinkedInUser, WorkflowStep } from '../types';

export const Header: React.FC<{
  user: LinkedInUser | null;
  accounts?: LinkedInUser[];
  onLogout: (urn?: string) => void;
  onSwitchAccount?: (urn: string) => void;
  onLoginAnother?: () => void;
  onViewDashboard?: () => void;
}> = ({ user, accounts = [], onLogout, onSwitchAccount, onLoginAnother, onViewDashboard }) => {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <header className="bg-white border-b border-slate-200 py-4 px-6 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => (window.location.href = '/')}>
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow-lg shadow-blue-100">
            <span className="text-white font-bold text-xl">L</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">LinkUp <span className="text-blue-600">AI</span></h1>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={onViewDashboard}
            className="text-sm font-bold text-slate-600 hover:text-blue-600 flex items-center gap-2 transition-colors px-3 py-2 rounded-lg hover:bg-slate-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            History
          </button>

          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-3 p-1 pr-3 rounded-full hover:bg-slate-50 transition-all border border-transparent hover:border-slate-200"
              >
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center overflow-hidden border-2 border-white shadow-sm">
                  {user.picture ? (
                    <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-blue-600 font-bold">{user.name.charAt(0)}</span>
                  )}
                </div>
                <div className="hidden md:flex flex-col items-start leading-none gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{user.name}</span>
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                  </div>
                  <span className="text-[10px] text-green-600 font-bold uppercase tracking-tighter">Connected</span>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                  <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl border border-slate-200 shadow-2xl z-20 overflow-hidden animate-fadeIn">
                    <div className="p-4 bg-slate-50 border-b border-slate-100">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full border-2 border-white shadow-sm overflow-hidden">
                          <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex flex-col">
                          <h4 className="font-bold text-slate-900 text-sm">{user.name}</h4>
                          <p className="text-[10px] text-slate-500 truncate max-w-[180px]">{user.email}</p>
                        </div>
                        <div className="ml-auto px-2 py-1 bg-green-100 text-green-700 text-[8px] font-black rounded-full uppercase">Active</div>
                      </div>

                      {accounts.length > 1 && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Switch Account</p>
                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {accounts.filter(a => a.urn !== user.urn).map(acc => (
                              <button
                                key={acc.urn}
                                onClick={() => { onSwitchAccount?.(acc.urn); setShowDropdown(false); }}
                                className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white transition-all border border-transparent hover:border-slate-100 group"
                              >
                                <img src={acc.picture} alt={acc.name} className="w-8 h-8 rounded-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                                <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900">{acc.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="p-2 space-y-1">
                      <button
                        onClick={() => { onLoginAnother?.(); setShowDropdown(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-blue-600 hover:bg-blue-50 rounded-xl transition-colors font-bold"
                      >
                        <span className="text-base text-blue-400">➕</span> Add Another Account
                      </button>
                      <button
                        onClick={() => { onLogout(user.urn); setShowDropdown(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-red-600 hover:bg-red-50 rounded-xl transition-colors font-bold"
                      >
                        <span className="text-base text-red-400">🚪</span> Logout {user.name.split(' ')[0]}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-100/50 text-slate-400 rounded-lg text-xs font-bold border border-slate-200">
              <span className="w-2 h-2 bg-slate-300 rounded-full" />
              Sign In Required
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export const StepIndicator: React.FC<{ currentStep: WorkflowStep }> = ({ currentStep }) => {
  const steps = [
    { label: "Setup", key: WorkflowStep.SOURCE_SELECTION },
    { label: "Schedule", key: WorkflowStep.SCHEDULING },
    { label: "Refine", key: WorkflowStep.PREFERENCES },
    { label: "Preview", key: WorkflowStep.REVIEW },
  ];

  const currentIdx = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="flex justify-center mb-12 animate-fadeIn">
      <div className="flex items-center gap-2">
        {steps.map((stepObj, idx) => (
          <React.Fragment key={stepObj.label}>
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-500 ${idx <= currentIdx ? 'bg-blue-600 text-white shadow-xl shadow-blue-200' : 'bg-slate-200 text-slate-400'
                }`}>
                {idx + 1}
              </div>
              <span className={`text-[10px] mt-2 font-black uppercase tracking-widest ${idx <= currentIdx ? 'text-blue-600' : 'text-slate-400'}`}>
                {stepObj.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-12 h-1 mb-6 rounded-full ${idx < currentIdx ? 'bg-blue-600' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
