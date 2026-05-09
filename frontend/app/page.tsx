import { TopBar } from "../components/TopBar";
import { ChatPanel } from "../components/ChatPanel";
import { PortfolioPanel } from "../components/PortfolioPanel";
import { ThreatPanel } from "../components/ThreatPanel";

export default function Page() {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="grid flex-1 grid-cols-[440px_1fr_340px] overflow-hidden">
        <div className="overflow-hidden">
          <ChatPanel />
        </div>
        <div className="overflow-hidden border-l border-line">
          <PortfolioPanel />
        </div>
        <div className="overflow-hidden border-l border-line">
          <ThreatPanel />
        </div>
      </div>
    </div>
  );
}
