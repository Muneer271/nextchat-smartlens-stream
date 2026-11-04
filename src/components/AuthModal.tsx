import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { auth, signInWithGoogle, signOutUser } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { LogIn, LogOut, User as UserIcon, Shield, Cloud } from 'lucide-react';

export const AuthModal: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await signInWithGoogle();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
  };

  if (!currentUser) {
    return (
      <button
        onClick={handleSignIn}
        disabled={isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white rounded-xl text-xs font-semibold shadow transition-all"
      >
        <LogIn className="w-3.5 h-3.5" />
        {isLoading ? 'Signing in...' : 'Sign In with Google'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 py-1 px-2.5 rounded-xl text-xs shadow-sm">
      {currentUser.photoURL ? (
        <img
          src={currentUser.photoURL}
          alt={currentUser.displayName || 'User'}
          className="w-5 h-5 rounded-full object-cover border border-cyan-500/50"
        />
      ) : (
        <UserIcon className="w-4 h-4 text-cyan-400" />
      )}
      <span className="text-slate-200 font-medium max-w-[120px] truncate hidden sm:inline">
        {currentUser.displayName || currentUser.email}
      </span>
      <button
        onClick={handleSignOut}
        className="text-slate-400 hover:text-rose-400 p-1 rounded transition-colors ml-1"
        title="Sign Out"
      >
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
