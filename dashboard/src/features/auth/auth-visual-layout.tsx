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
          <filter id="glow-laser" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" result="blur1" />
            <feGaussianBlur stdDeviation="3.5" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-core" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" result="coreBlur" />
            <feMerge>
              <feMergeNode in="coreBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="flare-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="25%" stopColor="#ff3b47" stopOpacity="0.8" />
            <stop offset="60%" stopColor="#dc2626" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#991b1b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="laser-grad-main" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#991b1b" stopOpacity="0.2" />
            <stop offset="25%" stopColor="#ef4444" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#ff3b47" stopOpacity="1" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id="ribbon-mesh-grad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7f1d1d" stopOpacity="0.06" />
            <stop offset="35%" stopColor="#dc2626" stopOpacity="0.25" />
            <stop offset="65%" stopColor="#ef4444" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#991b1b" stopOpacity="0.05" />
          </linearGradient>
          <pattern id="particle-dots" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="2.5" cy="2.5" r="1.1" fill="#ef4444" opacity="0.65" />
          </pattern>
        </defs>

        {/* Translucent flowing ribbon body */}
        <path d="M -100 920 C 220 840, 560 700, 860 520 C 1160 340, 1420 230, 1720 150 L 1720 235 C 1420 315, 1160 440, 860 620 C 560 800, 220 920, -100 1020 Z" fill="url(#ribbon-mesh-grad)" />
        <path d="M -100 920 C 220 840, 560 700, 860 520 C 1160 340, 1420 230, 1720 150 L 1720 235 C 1420 315, 1160 440, 860 620 C 560 800, 220 920, -100 1020 Z" fill="url(#particle-dots)" />

        {/* Primary sweeping neon laser curve */}
        <path d="M -100 970 C 220 880, 560 740, 860 560 C 1160 380, 1420 270, 1720 190" stroke="url(#laser-grad-main)" strokeWidth="4" filter="url(#glow-laser)" />
        <path d="M -100 970 C 220 880, 560 740, 860 560 C 1160 380, 1420 270, 1720 190" stroke="#ffffff" strokeWidth="1.4" opacity="0.85" filter="url(#glow-core)" />

        {/* Upper futuristic red laser sweep */}
        <path d="M -60 310 C 340 130, 760 60, 1220 50 C 1460 45, 1610 85, 1760 150" stroke="#ef4444" strokeWidth="2.5" opacity="0.8" filter="url(#glow-laser)" />
        <path d="M 80 -10 C 440 90, 860 210, 1310 410 C 1530 510, 1670 640, 1760 810" stroke="#ff3344" strokeWidth="1.6" opacity="0.55" filter="url(#glow-laser)" />
        <path d="M -80 850 C 330 750, 690 560, 1110 410 C 1360 330, 1560 290, 1760 270" stroke="#dc2626" strokeWidth="1.9" opacity="0.7" />

        {/* Luminous starburst/flare nodes with radiant cross streaks */}
        <g transform="translate(1180, 370)">
          <line x1="-70" y1="0" x2="70" y2="0" stroke="#ff3b47" strokeWidth="1.2" opacity="0.7" filter="url(#glow-laser)" />
          <line x1="0" y1="-70" x2="0" y2="70" stroke="#ff3b47" strokeWidth="1.2" opacity="0.7" filter="url(#glow-laser)" />
          <circle cx="0" cy="0" r="32" fill="url(#flare-glow)" />
          <circle cx="0" cy="0" r="3" fill="#ffffff" filter="url(#glow-core)" />
        </g>
        <g transform="translate(740, 610)">
          <circle cx="0" cy="0" r="28" fill="url(#flare-glow)" />
          <circle cx="0" cy="0" r="2.8" fill="#ffffff" filter="url(#glow-core)" />
        </g>
        <g transform="translate(340, 790)">
          <circle cx="0" cy="0" r="24" fill="url(#flare-glow)" />
          <circle cx="0" cy="0" r="2.4" fill="#ffffff" filter="url(#glow-core)" />
        </g>
      </svg>
      {/* Hero Header Area: Contains Logo, Category Eyebrow, Heading, and Description */}
      <section className={`auth-hero-top${showCardLogo ? ' auth-hero-top-invitation' : ''}`}>
        <div className="auth-hero-logo-frame">
          <img src={samcheLogo} alt="SamChe Company LLC" className="auth-hero-logo" />
        </div>
        <div className="auth-hero-text">
          <p className="auth-hero-eyebrow">{heroEyebrow}</p>
          <h1 className="auth-hero-heading">{displayHeading}</h1>
          <p className="auth-hero-description">{displayDescription}</p>
        </div>
      </section>

      {/* Form Card Area: Contains the login/invitation card */}
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

      {/* Hero Bottom Area: Contains the 6 Capability Cards & Copyright Footer */}
      <section className="auth-hero-bottom">
        <div className="auth-capability-grid grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
          {capabilities.slice(0, capabilityCount).map(([title, description, Icon]) => (
            <article key={title} className="auth-capability-card">
              <Icon aria-hidden="true" className="text-red-500" size={24} strokeWidth={1.8} />
              <h2>{title}</h2>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <p className="auth-hero-footer">© {new Date().getFullYear()} SamChe Company LLC. All rights reserved.</p>
      </section>
    </main>
  );
}
