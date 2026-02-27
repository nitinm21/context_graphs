'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const INTRO_DISMISSED_KEY = 'irishman-context-graphs:intro-dismissed:v1';

type FirstRunExplainerGateProps = {
  children: ReactNode;
};

export default function FirstRunExplainerGate({ children }: FirstRunExplainerGateProps) {
  const [isOpen, setIsOpen] = useState(true);
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(INTRO_DISMISSED_KEY) === '1') {
        setIsOpen(false);
      }
    } catch {
      // Ignore storage failures and leave the explainer visible.
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      document.body.classList.remove('modal-open');
      return;
    }
    document.body.classList.add('modal-open');
    continueButtonRef.current?.focus();
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen]);

  function handleContinue() {
    try {
      window.localStorage.setItem(INTRO_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage failures; local state still closes the dialog.
    }
    setIsOpen(false);
  }

  return (
    <>
      {children}
      {isOpen ? (
        <div className="first-run-modal-root" aria-live="polite">
          <div className="first-run-modal-backdrop" />
          <div
            className="first-run-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="first-run-modal-title"
            aria-describedby="first-run-modal-description"
          >
            <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>
              Welcome
            </p>
            <h2 id="first-run-modal-title">What this app is showing</h2>
            <div id="first-run-modal-description" className="first-run-modal-copy">
              <p>
                This application lets you ask story questions about <span className="mono">The Irishman</span> and compare
                graph-based answers side by side.
              </p>
              <p>
                The knowledge graph highlights stable entities and relationships (who is connected to whom). The context graph in
                this app is the Narrative Context Graph, which captures ordered events, temporal links, and state changes (what
                happened, when it changed, and why).
              </p>
              <p>
                Use the same question across views to see when static structure is enough and when narrative context is necessary.
              </p>
            </div>
            <div className="first-run-modal-actions">
              <button ref={continueButtonRef} type="button" className="button" onClick={handleContinue}>
                Start Exploring
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
