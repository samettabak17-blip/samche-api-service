import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { ConfirmationDialog } from './confirmation-dialog';
import { MutationFeedback } from './mutation-feedback';

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
});

