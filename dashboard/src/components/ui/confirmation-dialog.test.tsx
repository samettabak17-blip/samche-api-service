import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { ConfirmationDialog } from './confirmation-dialog';
import { MutationFeedback } from './mutation-feedback';

afterEach(cleanup);

describe('safe mutation UI', () => {
  it('requires explicit confirmation before invoking a destructive action', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationDialog open title="Delete channel" description="This cannot be undone." confirmLabel="Delete" onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole('dialog', { name: 'Delete channel' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('keeps an API 409 message visible to the user', () => {
    render(<MutationFeedback error={new ApiError(409, 'Channel cannot be deleted while conversations are linked to it')} />);
    expect(screen.getByText('Channel cannot be deleted while conversations are linked to it')).toBeTruthy();
  });

  it('uses a portal modal that traps focus and restores it on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open confirmation';
    document.body.append(opener);
    opener.focus();
    const onCancel = vi.fn();
    const { container, rerender } = render(<ConfirmationDialog open title="Delete channel" description="This cannot be undone." confirmLabel="Delete" onCancel={onCancel} onConfirm={vi.fn()} />);

    const dialogs = screen.getAllByRole('dialog', { name: 'Delete channel' });
    const dialog = dialogs[dialogs.length - 1]!;
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.style.overflow).toBe('hidden');

    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    confirm.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(<ConfirmationDialog open={false} title="Delete channel" description="This cannot be undone." confirmLabel="Delete" onCancel={onCancel} onConfirm={vi.fn()} />);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

