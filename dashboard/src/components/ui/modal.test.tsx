import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Modal } from './modal';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('Modal', () => {
  it('moves focus inside, traps it, restores it, and keeps caller width limits', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Open workspace actions</button><Modal open={open} title="Workspace actions" onClose={() => setOpen(false)} className="max-w-3xl"><select aria-label="Selected tenant"><option>SamChe</option></select><button type="button">Sign out</button></Modal></>;
    }

    render(<Harness />);

    const opener = screen.getByRole('button', { name: 'Open workspace actions' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Workspace actions' });
    const firstAction = screen.getByRole('combobox', { name: 'Selected tenant' });
    const lastAction = screen.getByRole('button', { name: 'Sign out' });

    expect(firstAction).toHaveFocus();
    expect(dialog).toHaveClass('dashboard-modal', 'max-w-3xl');
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(lastAction).toHaveFocus();
  });
});
