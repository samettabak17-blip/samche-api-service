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
      {/* Authoritative Futuristic Red Laser & Particle Mesh Background */}
      <svg
        className="auth-laser-bg pointer-events-none absolute inset-0 -z-10 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1600 983"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="glow-laser" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur1" />
            <feGaussianBlur stdDeviation="3" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-core" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" result="coreBlur" />
            <feMerge>
              <feMergeNode in="coreBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="flare-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff4444" stopOpacity="0.9" />
            <stop offset="35%" stopColor="#dc2626" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#991b1b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="laser-grad-main" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#991b1b" stopOpacity="0.2" />
            <stop offset="30%" stopColor="#ef4444" stopOpacity="0.9" />
            <stop offset="70%" stopColor="#ff3b47" stopOpacity="1" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="ribbon-mesh-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7f1d1d" stopOpacity="0.05" />
            <stop offset="40%" stopColor="#dc2626" stopOpacity="0.22" />
            <stop offset="70%" stopColor="#ef4444" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#991b1b" stopOpacity="0.04" />
          </linearGradient>
          <pattern id="particle-dots" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.1" fill="#ef4444" opacity="0.6" />
          </pattern>
        </defs>

        {/* Translucent flowing ribbon body */}
        <path d="M -100 900 C 200 830, 550 710, 850 530 C 1150 350, 1420 240, 1700 160 L 1700 240 C 1420 320, 1150 450, 850 630 C 550 810, 200 930, -100 1020 Z" fill="url(#ribbon-mesh-grad)" />
        <path d="M -100 900 C 200 830, 550 710, 850 530 C 1150 350, 1420 240, 1700 160 L 1700 240 C 1420 320, 1150 450, 850 630 C 550 810, 200 930, -100 1020 Z" fill="url(#particle-dots)" />

        {/* Primary sweeping neon laser curve */}
        <path d="M -100 960 C 200 870, 550 750, 850 570 C 1150 390, 1420 280, 1700 200" stroke="url(#laser-grad-main)" strokeWidth="3.5" filter="url(#glow-laser)" />
        <path d="M -100 960 C 200 870, 550 750, 850 570 C 1150 390, 1420 280, 1700 200" stroke="#ffffff" strokeWidth="1.2" opacity="0.8" filter="url(#glow-core)" />

        {/* Upper futuristic red laser sweep */}
        <path d="M -50 320 C 350 140, 750 70, 1200 60 C 1450 55, 1600 95, 1750 160" stroke="#ef4444" strokeWidth="2.4" opacity="0.75" filter="url(#glow-laser)" />
        <path d="M 100 0 C 450 100, 850 220, 1300 420 C 1520 520, 1660 650, 1750 820" stroke="#ff3344" strokeWidth="1.5" opacity="0.5" filter="url(#glow-laser)" />
        <path d="M -80 840 C 320 740, 680 570, 1100 420 C 1350 340, 1550 300, 1750 280" stroke="#dc2626" strokeWidth="1.8" opacity="0.65" />

        {/* Luminous starburst/flare nodes */}
        <circle cx="740" cy="620" r="32" fill="url(#flare-glow)" />
        <circle cx="740" cy="620" r="3" fill="#ffffff" filter="url(#glow-core)" />
        <circle cx="1180" cy="380" r="28" fill="url(#flare-glow)" />
        <circle cx="1180" cy="380" r="2.5" fill="#ffffff" filter="url(#glow-core)" />
        <circle cx="340" cy="800" r="24" fill="url(#flare-glow)" />
        <circle cx="340" cy="800" r="2.5" fill="#ffffff" filter="url(#glow-core)" />
      </svg>
      {/* Hero Section */}
      <section className="auth-hero">
        <div className="auth-hero-content">
          <div className="auth-hero-logo-frame">
            <img src={samcheLogo} alt="SamChe Company LLC" className="auth-hero-logo" />
          </div>
          <p className="auth-hero-eyebrow">{heroEyebrow}</p>
          <h1 className="auth-hero-heading">{displayHeading}</h1>
          <p className="auth-hero-description">{displayDescription}</p>
        </div>

        <div className="auth-hero-bottom">
          <div className="auth-capability-grid grid grid-cols-2 gap-3 xl:grid-cols-6">
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

      {/* Card Panel */}
      <section className={`auth-panel${showCardLogo ? ' auth-panel-invitation' : ''}`}>
        <div className={`auth-card${showCardLogo ? ' auth-card-invitation' : ''}`}>
          {showCardLogo && (
            <div className="auth-card-logo-frame">
              <img src={samcheLogo} alt="SamChe Company LLC" className="auth-card-logo" />
            </div>
          )}
          {children}
        </div>
      </section>
    </main>
  );
}
