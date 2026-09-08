import { Activity, Bot, BookOpenText, Cable, KanbanSquare, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';

const capabilities = [
  ['AI Assistants', 'Create and manage intelligent assistants', Bot],
  ['Knowledge Intelligence', 'Turn approved knowledge into useful answers', BookOpenText],
  ['Omnichannel', 'Connect conversations across every channel', Cable],
  ['CRM & Pipeline', 'Move leads and deals forward with clarity', KanbanSquare],
  ['Automation / Agentic', 'Automate work with capable AI agents', Zap],
  ['Analytics', 'Turn conversations into clear decisions', Activity],
] as const;

export function AuthVisualLayout({
  children,
  heroEyebrow = 'SAMCHE AI PLATFORM',
  heroHeading,
  heroLines,
  heroDescription,
  capabilityCount = 6,
  showCardLogo = false,
}: {
  children: ReactNode;
  heroEyebrow?: string;
  heroHeading?: string;
  heroLines?: readonly string[];
  heroDescription?: string;
  capabilityCount?: number;
  showCardLogo?: boolean;
}) {
  const displayHeading = heroHeading || (heroLines ? heroLines.join(' ') : 'Manage your AI operations from a single platform.');
  const displayDescription = heroDescription || 'Unify assistants, conversations, knowledge and automation to deliver smarter results, every day.';

  return (
    <main className="auth-page">
      <svg className="auth-laser-bg pointer-events-none absolute inset-0 -z-10 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1440 900" fill="none">
        <defs>
          <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d="M-100,850 Q300,750 650,550 T1200,350 T1600,200" stroke="#dc2626" strokeWidth="2.5" opacity="0.85" filter="url(#glow-red)" />
        <path d="M-50,900 Q350,800 700,570 T1250,330 T1650,150" stroke="#ef4444" strokeWidth="1.2" opacity="0.6" filter="url(#glow-red)" />
        <path d="M0,880 Q400,700 800,500 T1350,280" stroke="#b91c1c" strokeWidth="0.8" opacity="0.4" />
      </svg>
      <section className="auth-hero">
        <div className="auth-hero-content">
          <div className="auth-hero-logo-frame">
            <img src={samcheLogo} alt="SamChe Company LLC" className="auth-hero-logo" />
          </div>
          <p className="auth-hero-eyebrow">{heroEyebrow}</p>
          <h1 className="auth-hero-heading">{displayHeading}</h1>
          <p className="auth-hero-description">{displayDescription}</p>
        </div>
        <div>
          <div className="auth-capability-grid">
            {capabilities.slice(0, capabilityCount).map(([title, description, Icon]) => (
              <article key={title} className="auth-capability-card">
                <Icon aria-hidden="true" className="text-red-500" size={24} strokeWidth={1.8} />
                <h2>{title}</h2>
                <p>{description}</p>
              </article>
            ))}
          </div>
          <p className="auth-hero-footer">© {new Date().getFullYear()} SamChe Company LLC. All rights reserved.</p>
        </div>
      </section>
      <section className={`auth-panel${showCardLogo ? ' auth-panel-invitation' : ''}`}>
        <div className={`auth-card${showCardLogo ? ' auth-card-invitation' : ''}`}>
          {showCardLogo && (
            <div className="auth-card-logo-frame">
              <img src={samcheLogo} alt="SamChe Company LLC" className="auth-card-logo" />
            </div>
          )}
          {!showCardLogo && (
            <div className="auth-mobile-brand lg:hidden">
              <img src={samcheLogo} alt="SamChe Company LLC" className="mx-auto h-9 w-auto object-contain" />
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-[#ef4444]">SAMCHE AI PLATFORM</p>
            </div>
          )}
          {children}
        </div>
      </section>
    </main>
  );
}
