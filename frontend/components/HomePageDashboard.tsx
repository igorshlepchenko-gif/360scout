import React, { useState, useEffect } from 'react';
import MatchAnalysisCard from './MatchAnalysisCard';

export default function HomePageDashboard() {
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/live')
      .then(res => res.json())
      .then(response => {
        if (response.matches) {
          setMatches(response.matches);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading data:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="text-center py-10 text-slate-400">
        טוען את נתוני האנליטיקה של היום...
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 bg-slate-950 min-h-screen">
      <h2 className="text-2xl font-black text-center text-slate-100 mb-8">
        משחקי היום המומלצים לפי{' '}
        <span className="text-cyan-400">The Winning Method</span>
      </h2>

      <div className="space-y-6">
        {matches.map(match => (
          <MatchAnalysisCard key={match.fixture_id} matchData={match} />
        ))}
        {matches.length === 0 && (
          <div className="text-center py-10 text-slate-500">
            אין משחקים זמינים כרגע
          </div>
        )}
      </div>
    </div>
  );
}
