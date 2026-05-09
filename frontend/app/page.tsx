import { TopBar } from "../components/TopBar";
import { ChatPanel } from "../components/ChatPanel";
import { PortfolioPanel } from "../components/PortfolioPanel";
import { ThreatPanel } from "../components/ThreatPanel";

export default function Page() {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-[440px_1fr_340px] overflow-hidden">
        <div className="min-h-0 overflow-hidden">
          <ChatPanel />
        </div>
        <div className="min-h-0 overflow-hidden border-l border-line">
          <PortfolioPanel />
        </div>
        <div className="min-h-0 overflow-hidden border-l border-line">
          <ThreatPanel />
        </div>
      </div>
    </div>
  );
}
