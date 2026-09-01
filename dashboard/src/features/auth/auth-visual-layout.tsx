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

export function AuthVisualLayout({ children, heroEyebrow = 'SamChe AI Platform', heroLines = ['AI OPERATIONS.', 'SMARTER.', 'STRONGER.'], heroDescription = 'Manage your AI assistants, channels, knowledge and conversations from a single, powerful command center.', capabilityCount = 6, showCardLogo = false }: { children: ReactNode; heroEyebrow?: string; heroLines?: readonly string[]; heroDescription?: string; capabilityCount?: number; showCardLogo?: boolean }) {
  return <main className="auth-page">
    <section className="auth-hero">
      <div aria-hidden="true" className="auth-hero-glow auth-hero-glow-red" />
      <div aria-hidden="true" className="auth-hero-glow auth-hero-glow-gold" />
      <div className="auth-hero-content">
        <img src={samcheLogo} alt="SamChe Company LLC" className="auth-hero-logo" />
        <p className="auth-hero-eyebrow">{heroEyebrow}</p>
        <div className="auth-hero-heading">{heroLines.map((line, index) => <h1 key={line} className={index === heroLines.length - 1 ? 'text-signal' : undefined}>{line}</h1>)}</div>
        <div className="auth-hero-rule" />
        <p className="auth-hero-description">{heroDescription}</p>
      </div>
      <div className="auth-capability-grid">{capabilities.slice(0, capabilityCount).map(([title, description, Icon]) => <article key={title} className="auth-capability-card"><Icon aria-hidden="true" className="text-signal" size={27} strokeWidth={1.8} /><h2>{title}</h2><p>{description}</p></article>)}</div>
      <p className="auth-hero-footer">© {new Date().getFullYear()} SamChe Company LLC. All rights reserved.</p>
    </section>
    <section className="auth-panel"><div className="auth-card">{showCardLogo && <img src={samcheLogo} alt="SamChe Company LLC" className="auth-card-logo" />}{!showCardLogo && <div className="auth-mobile-brand"><img src={samcheLogo} alt="SamChe Company LLC" /><p>SamChe AI Platform</p></div>}{children}</div></section>
  </main>;
}
