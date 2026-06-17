"use client";
import { Component, type ReactNode } from "react";
import { type LiveMatch } from "./MatchLiveRow";

interface Props {
  match: LiveMatch;
  children: ReactNode;
}

interface State {
  crashed: boolean;
}

export default class MatchLiveRowBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="rounded-xl border border-slate-800 bg-[#0F1318] px-4 py-3 text-xs text-slate-500">
          {this.props.match.home_team} vs {this.props.match.away_team} — שגיאת תצוגה
        </div>
      );
    }
    return this.props.children;
  }
}
